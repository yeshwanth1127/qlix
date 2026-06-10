import 'dart:async';
import 'dart:convert';

/// A single Server-Sent Event with its `event:` name and concatenated `data:`.
class SseEvent {
  const SseEvent(this.event, this.data);
  final String event;
  final String data;
}

/// Transforms a raw byte stream (`dio` `ResponseType.stream`) into [SseEvent]s.
///
/// Flutter has no native `EventSource`, so we hand-parse the wire format:
/// accumulate `event:` and `data:` fields until a blank line, then emit. This
/// mirrors how the web client consumes `/runs/:runId/stream`.
Stream<SseEvent> parseSse(Stream<List<int>> byteStream) {
  late StreamController<SseEvent> controller;
  StreamSubscription<String>? sub;

  var buffer = '';
  var eventName = 'message';
  final dataLines = <String>[];

  void flush() {
    if (dataLines.isEmpty && eventName == 'message') {
      // Comment/keepalive only — nothing to emit.
      eventName = 'message';
      return;
    }
    final data = dataLines.join('\n');
    final name = eventName;
    dataLines.clear();
    eventName = 'message';
    if (data.isNotEmpty || name != 'message') {
      controller.add(SseEvent(name, data));
    }
  }

  void handleLine(String rawLine) {
    // Strip a single trailing CR (CRLF line endings).
    final line = rawLine.endsWith('\r')
        ? rawLine.substring(0, rawLine.length - 1)
        : rawLine;

    if (line.isEmpty) {
      flush();
      return;
    }
    if (line.startsWith(':')) {
      // Comment line — ignored.
      return;
    }
    final colon = line.indexOf(':');
    final field = colon == -1 ? line : line.substring(0, colon);
    var value = colon == -1 ? '' : line.substring(colon + 1);
    if (value.startsWith(' ')) value = value.substring(1);

    switch (field) {
      case 'event':
        eventName = value;
        break;
      case 'data':
        dataLines.add(value);
        break;
      default:
        break;
    }
  }

  controller = StreamController<SseEvent>(
    onListen: () {
      sub = byteStream.transform(utf8.decoder).listen(
        (chunk) {
          buffer += chunk;
          var idx = buffer.indexOf('\n');
          while (idx != -1) {
            final line = buffer.substring(0, idx);
            buffer = buffer.substring(idx + 1);
            handleLine(line);
            idx = buffer.indexOf('\n');
          }
        },
        onError: controller.addError,
        onDone: () {
          if (buffer.isNotEmpty) handleLine(buffer);
          flush();
          controller.close();
        },
        cancelOnError: true,
      );
    },
    onCancel: () async {
      await sub?.cancel();
    },
  );

  return controller.stream;
}
