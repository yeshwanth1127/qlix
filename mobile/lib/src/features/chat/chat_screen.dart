import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/agent.dart';
import '../../models/chat.dart';
import '../../theme.dart';
import '../../ui/sketch.dart';
import 'chat_controller.dart';

/// Cloud models offered in the picker (mirrors `CLOUD_MODELS` in agents-api.ts).
const _cloudModels = [
  'openrouter/anthropic/claude-sonnet-4.6',
  'openrouter/openai/gpt-4o',
  'openrouter/openai/gpt-4o-mini',
  'openrouter/google/gemini-2.5-flash',
  'openrouter/qwen/qwen-2.5-72b-instruct',
];

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.agentId, this.agentName});

  final String agentId;
  final String? agentName;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  String? _selectedModel;
  bool _useBrain = false;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _send(ChatController controller) {
    final text = _input.text;
    if (text.trim().isEmpty) return;
    _input.clear();
    controller.send(text, model: _selectedModel, useBrain: _useBrain);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final provider = chatControllerProvider(widget.agentId);
    final state = ref.watch(provider);
    final controller = ref.read(provider.notifier);

    ref.listen(provider, (prev, next) {
      if (prev?.messages.length != next.messages.length ||
          (prev?.messages.isNotEmpty == true &&
              next.messages.isNotEmpty &&
              prev!.messages.last.content != next.messages.last.content)) {
        _scrollToBottom();
      }
    });

    final hosted = state.agent?.isHostedChatRuntime ?? true;

    return SketchBackdrop(
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(widget.agentName ?? state.agent?.name ?? 'Chat'),
          actions: [
            IconButton(
              tooltip: 'Clear conversation',
              icon: state.clearing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.delete_outline),
              onPressed: state.clearing ? null : controller.clear,
            ),
          ],
        ),
        body: Column(
          children: [
            if (state.error != null) _Banner(message: state.error!),
            Expanded(
              child: state.loading
                  ? const Center(child: OrbitLoader())
                  : state.messages.isEmpty
                      ? _EmptyChat(agentName: widget.agentName)
                      : ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.all(16),
                          itemCount: state.messages.length,
                          itemBuilder: (context, i) =>
                              _MessageBubble(message: state.messages[i]),
                        ),
            ),
            _Composer(
              input: _input,
              sending: state.sending,
              hosted: hosted,
              canUseBrain: state.canUseBrain,
              useBrain: _useBrain,
              onBrainChanged: (v) => setState(() => _useBrain = v),
              selectedModel: _selectedModel,
              modelOptions: _modelOptions(state.agent?.model),
              onModelChanged: (v) => setState(() => _selectedModel = v),
              onSend: () => _send(controller),
              onStop: controller.stop,
            ),
          ],
        ),
      ),
    );
  }

  List<String> _modelOptions(String? agentModel) {
    final options = <String>{..._cloudModels};
    if (agentModel != null && agentModel.isNotEmpty) options.add(agentModel);
    return options.toList();
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});
  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == ChatRole.user;
    final isSystem = message.role == ChatRole.system;
    final scheme = Theme.of(context).colorScheme;

    if (isSystem) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Text(
            message.content,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontStyle: FontStyle.italic,
                ),
          ),
        ),
      );
    }

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 6),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.82,
        ),
        child: Column(
          crossAxisAlignment:
              isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            if (message.activity.isNotEmpty) ...[
              _ActivityTimeline(steps: message.activity),
              const SizedBox(height: 6),
            ],
            if (message.browserFrames.isNotEmpty) ...[
              _BrowserFrames(frames: message.browserFrames),
              const SizedBox(height: 6),
            ],
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser ? QlixColors.ink : QlixColors.glass,
                borderRadius: BorderRadius.circular(16),
                border: isUser
                    ? null
                    : Border.all(color: QlixColors.inkBorder),
                boxShadow: isUser
                    ? [
                        BoxShadow(
                          color: QlixColors.accent.withValues(alpha: 0.18),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                          spreadRadius: -8,
                        ),
                      ]
                    : null,
              ),
              child: isUser
                  ? Text(
                      message.content,
                      style: const TextStyle(color: QlixColors.white),
                    )
                  : (message.content.trim().isEmpty
                      ? _TypingDots()
                      : MarkdownBody(
                          data: message.content,
                          styleSheet: MarkdownStyleSheet.fromTheme(
                            Theme.of(context),
                          ),
                        )),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActivityTimeline extends StatelessWidget {
  const _ActivityTimeline({required this.steps});
  final List<ActivityStep> steps;

  String _tone(ActivityTone t) => t.name;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: QlixColors.glass,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: QlixColors.inkBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: steps.map((s) {
          final color = toneColor(context, _tone(s.tone));
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 5, right: 8),
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration:
                        BoxDecoration(color: color, shape: BoxShape.circle),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        s.label,
                        style: Theme.of(context)
                            .textTheme
                            .labelMedium
                            ?.copyWith(color: color, fontWeight: FontWeight.w600),
                      ),
                      if (s.detail != null && s.detail!.isNotEmpty)
                        Text(
                          s.detail!,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _BrowserFrames extends StatelessWidget {
  const _BrowserFrames({required this.frames});
  final List<BrowserFrame> frames;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 120,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: frames.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final frame = frames[i];
          return GestureDetector(
            onTap: () => _showFullScreen(context, frame),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: _frameImage(frame, fit: BoxFit.cover, width: 180),
            ),
          );
        },
      ),
    );
  }

  void _showFullScreen(BuildContext context, BrowserFrame frame) {
    showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppBar(
              backgroundColor: Colors.transparent,
              title: Text(frame.label),
              automaticallyImplyLeading: false,
              actions: [
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            Flexible(
              child: InteractiveViewer(
                child: _frameImage(frame, fit: BoxFit.contain),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _frameImage(BrowserFrame frame, {required BoxFit fit, double? width}) {
    try {
      return Image.memory(
        base64Decode(frame.imageBase64),
        fit: fit,
        width: width,
        gaplessPlayback: true,
        errorBuilder: (_, _, _) => _broken(width),
      );
    } catch (_) {
      return _broken(width);
    }
  }

  Widget _broken(double? width) => Container(
        width: width,
        color: Colors.black26,
        alignment: Alignment.center,
        child: const Icon(Icons.broken_image_outlined),
      );
}

class _TypingDots extends StatefulWidget {
  @override
  State<_TypingDots> createState() => _TypingDotsState();
}

class _TypingDotsState extends State<_TypingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
        ..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final t = (_c.value + i * 0.2) % 1.0;
            final opacity = 0.3 + 0.7 * (1 - (t - 0.5).abs() * 2).clamp(0, 1);
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Opacity(
                opacity: opacity.toDouble(),
                child: const Text('●', style: TextStyle(fontSize: 10)),
              ),
            );
          }),
        );
      },
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.input,
    required this.sending,
    required this.hosted,
    required this.canUseBrain,
    required this.useBrain,
    required this.onBrainChanged,
    required this.selectedModel,
    required this.modelOptions,
    required this.onModelChanged,
    required this.onSend,
    required this.onStop,
  });

  final TextEditingController input;
  final bool sending;
  final bool hosted;
  final bool canUseBrain;
  final bool useBrain;
  final ValueChanged<bool> onBrainChanged;
  final String? selectedModel;
  final List<String> modelOptions;
  final ValueChanged<String?> onModelChanged;
  final VoidCallback onSend;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
        decoration: const BoxDecoration(
          color: Color(0xD6FFFFFF),
          border: Border(
            top: BorderSide(color: QlixColors.inkBorder),
          ),
        ),
        child: Column(
          children: [
            if (hosted || canUseBrain)
              Row(
                children: [
                  if (hosted)
                    Expanded(
                      child: _ModelPicker(
                        selected: selectedModel,
                        options: modelOptions,
                        onChanged: onModelChanged,
                      ),
                    ),
                  if (canUseBrain) ...[
                    const SizedBox(width: 8),
                    FilterChip(
                      avatar: const Icon(Icons.psychology_outlined, size: 18),
                      label: const Text('Brain'),
                      selected: useBrain,
                      selectedColor: QlixColors.accentSoft,
                      checkmarkColor: QlixColors.accent,
                      onSelected: onBrainChanged,
                    ),
                  ],
                ],
              ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: input,
                    minLines: 1,
                    maxLines: 5,
                    textInputAction: TextInputAction.newline,
                    decoration: const InputDecoration(
                      hintText: 'Message your agent…',
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                sending
                    ? IconButton.filled(
                        onPressed: onStop,
                        icon: const Icon(Icons.stop),
                        style: IconButton.styleFrom(
                          backgroundColor: QlixColors.redSoft,
                          foregroundColor: QlixColors.red,
                        ),
                      )
                    : IconButton.filled(
                        onPressed: onSend,
                        icon: const Icon(Icons.arrow_upward_rounded),
                        style: IconButton.styleFrom(
                          backgroundColor: QlixColors.ink,
                          foregroundColor: QlixColors.white,
                        ),
                      ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ModelPicker extends StatelessWidget {
  const _ModelPicker({
    required this.selected,
    required this.options,
    required this.onChanged,
  });

  final String? selected;
  final List<String> options;
  final ValueChanged<String?> onChanged;

  String _short(String id) => id.split('/').last;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String?>(
      initialValue: selected,
      isExpanded: true,
      decoration: const InputDecoration(
        labelText: 'Model',
        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      ),
      items: [
        const DropdownMenuItem<String?>(
          value: null,
          child: Text('Default', overflow: TextOverflow.ellipsis),
        ),
        ...options.map(
          (m) => DropdownMenuItem<String?>(
            value: m,
            child: Text(_short(m), overflow: TextOverflow.ellipsis),
          ),
        ),
      ],
      onChanged: onChanged,
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat({this.agentName});
  final String? agentName;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: SectionIn(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const OrbitLoader(size: 56),
              const SizedBox(height: 20),
              Text(
                'Start chatting with ${agentName ?? 'your agent'}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              const SketchLabel('Streaming replies · live activity'),
            ],
          ),
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: QlixColors.redSoft,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: QlixColors.red, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: QlixColors.red, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
