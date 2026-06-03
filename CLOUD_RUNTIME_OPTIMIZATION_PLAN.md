# Cloud Runtime Optimization Plan

**Focus:** Cloud proxy inference path only (`use_backend_proxy = true`)  
**Primary Files:**
- `sdk/python/qlix/cloud_runner.py` - inference loop & tool execution orchestration
- `sdk/python/qlix/cloud_browser_runtime.py` - tool dispatch & frame capture
- `sdk/python/qlix/backend_inference_client.py` - backend API calls

---

## Cloud Runtime Path Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ cloud_runner.py:264-549 (_poll_and_execute_loop)               │
│  ├─ recoverStaleRuns()                                          │
│  ├─ claimNextQueuedRun()                                        │
│  └─ use_backend_proxy = true?                                   │
│     └─ _run_backend_proxy_inference()  [lines 74-235]          │
│        ├─ openai_browser_tool_definitions()  [1st call]        │
│        ├─ FOR round in max_rounds (12):                        │
│        │  ├─ backend_proxy_chat_completion()  [backend API]    │
│        │  ├─ Parse tool_calls from response                    │
│        │  ├─ FOR each tool_call:                               │
│        │  │  ├─ execute_browser_tool_sync()                    │
│        │  │  │  └─ ToolRegistry.get() + cls().execute()       │
│        │  │  ├─ append result to messages  [120K truncated]    │
│        │  │  └─ if should_capture_browser_frame():             │
│        │  │     ├─ sleep(0.35)                                 │
│        │  │     ├─ capture_browser_frame_for_ui()              │
│        │  │     └─ emit_event() → backend storage              │
│        │  └─ (back to next model call)                         │
│        └─ Return results
└─────────────────────────────────────────────────────────────────┘
```

---

## BOTTLENECK 1: Tool Schema Repetition in Every Round

### Current Code (cloud_runner.py:95-98)
```python
tools = openai_browser_tool_definitions(
    identity,
    selected_skills if selected_skills else None,
)
# Called ONCE here but...

for round_idx in range(max_rounds):  # line 120
    # ...
    proxy_result = await backend_proxy_chat_completion(
        http,
        # ...
        tools=tools if tools else None,  # SENT EVERY ROUND
        tool_choice="auto" if tools else None,
    )
```

### Problem
- `tools` list is static (won't change during loop)
- But full tool definitions sent to OpenRouter **every round** (lines 135, 137)
- **Tokens per round:** 1.5K-3K (6 tools × ~300 tokens each)
- **Total per 12-round run:** 18K-36K wasted tokens

### Why This Happens
OpenAI's API requires tools in every request if you want the model to choose them. No built-in mechanism to say "same tools as last time."

### Solution A: Prompt Caching (Backend Responsibility)

**Option 1: Backend Caches Tools Per Agent**
```python
# In backend_inference_client.py:43-46
response = await http.post_json(
    f"/api/v1/agents/{agent_id}/inference/chat",
    body,
    headers=headers,
)
```

The backend could:
1. Return a `tools_cached: true` flag on first request
2. On subsequent requests, omit tools + include `tools_cache_token`
3. Backend maintains agent-specific tool cache

**Implementation in cloud_runner.py:**
```python
tools_cache_token = None

for round_idx in range(max_rounds):
    body_for_inference = {
        "model": model,
        "messages": messages,
        # ... other fields ...
    }
    
    # Only send tools on first round or if cache invalidated
    if round_idx == 0:
        body_for_inference["tools"] = tools
        body_for_inference["tool_choice"] = "auto"
    elif tools_cache_token:
        body_for_inference["tools_cache_token"] = tools_cache_token
    
    proxy_result = await backend_proxy_chat_completion(http, ..., body_override=body_for_inference)
    
    if round_idx == 0 and proxy_result.tools_cache_token:
        tools_cache_token = proxy_result.tools_cache_token
```

**Expected savings:** 90% of tool schema tokens after round 1 (~500+ tokens/round × 11 = 5.5K per 12-round run)

---

### Solution B: Client-Side Deduplication (Simpler, Partial)

**Detect when tools haven't changed, communicate to backend:**

```python
# cloud_runner.py:95-110
tools = openai_browser_tool_definitions(identity, selected_skills)
tools_hash = hashlib.md5(json.dumps(tools, sort_keys=True).encode()).hexdigest()

for round_idx in range(max_rounds):
    if time.time() > deadline:
        break
    
    # Build request body
    request_body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    
    # Only include tools on first round OR if skill filter changed
    if round_idx == 0:
        request_body["tools"] = tools
        request_body["tool_choice"] = "auto"
        request_body["tools_hash"] = tools_hash  # for backend tracking
    else:
        request_body["tools_hash"] = tools_hash  # tell backend: same tools
        request_body["tool_choice"] = "auto"     # still allowed but schema cached
    
    proxy_result = await backend_proxy_chat_completion(http, ...)
```

**Backend optimization** (createInferenceProxyRouter.ts):
```typescript
// Backend sees tools_hash match on rounds 2+
// Can cache tool definitions per agent/skill combination
// Return tools only on first request of a conversation
```

---

## BOTTLENECK 2: Synchronous Tool Execution

### Current Code (cloud_runner.py:172-196)
```python
for tc in tc_list:  # for each tool call
    # ... extract tool name, args ...
    
    tool_out = await asyncio.to_thread(
        execute_browser_tool_sync, name, args, identity
    )  # BLOCKS until this tool finishes
    
    tool_names_ran.append(name)
    messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})
    
    # Then capture frame (ALSO BLOCKS)
    if should_capture_browser_frame(name):
        await asyncio.sleep(0.35)
        frame = await asyncio.to_thread(capture_browser_frame_for_ui)
        if frame:
            seq = await _emit_event(...)
```

### Problem
- If model returns 3 tools to call: [navigate, click, screenshot]
- Each tool ~500-800ms
- **Current:** 500 + 500 + 500 = **1,500ms**
- **Could be:** max(500, 500, 500) = **500ms** (3x faster)
- Plus frame captures happen sequentially

### Solution: Parallel Tool Execution

```python
# cloud_runner.py:172-196 REFACTORED

async def _execute_tool_call(tc: dict, identity: AgentIdentity) -> tuple[str, str, dict]:
    """Execute single tool call, return (tool_id, result, tool_call_dict)."""
    if not isinstance(tc, dict):
        return None, None, None
    
    fn = tc.get("function")
    if not isinstance(fn, dict):
        return None, None, None
    
    tid = str(tc.get("id", ""))
    name = str(fn.get("name", ""))
    args = str(fn.get("arguments", ""))
    
    if not tid or not name:
        return None, None, None
    
    try:
        tool_out = await asyncio.to_thread(
            execute_browser_tool_sync, name, args, identity
        )
        return tid, tool_out, tc
    except Exception as e:
        return tid, f"Tool error: {e}", tc


# In the main loop, replace sequential execution:
if tc_list:
    assistant_calls = [...]  # as before
    messages.append({"role": "assistant", "content": None, "tool_calls": assistant_calls})
    
    seq = await _emit_event(...)  # log the round
    
    # PARALLEL EXECUTION: gather all tool calls
    execution_tasks = [
        _execute_tool_call(tc, identity) for tc in tc_list
    ]
    results = await asyncio.gather(*execution_tasks, return_exceptions=False)
    
    # Add results to messages in order
    for tid, tool_out, tc in results:
        if tid and tool_out:
            tool_names_ran.append(str(tc.get("function", {}).get("name", "")))
            messages.append({
                "role": "tool",
                "tool_call_id": tid,
                "content": tool_out[:120_000]
            })
            
            # Frame capture can still happen per-tool but ASYNC
            if should_capture_browser_frame(tc.get("function", {}).get("name", "")):
                # Don't await here - fire and forget or batch
                asyncio.create_task(_emit_frame_async(http, ...))
    
    # Wait for all frame events before next round
    await asyncio.gather(*frame_tasks, return_exceptions=True)
    continue
```

**Expected improvement:** 2-3x latency reduction (500ms → 500-800ms even with 3 tools)

---

## BOTTLENECK 3: Frame Capture Overhead

### Current Code (cloud_runner.py:197-220)
```python
if should_capture_browser_frame(name):
    try:
        params = json.loads(args) if args.strip() else {}
        if not isinstance(params, dict):
            params = {}
    except json.JSONDecodeError:
        params = {}
    
    await asyncio.sleep(0.35)  # ← HARDCODED 350ms wait
    
    frame = await asyncio.to_thread(capture_browser_frame_for_ui)
    
    if frame:
        seq = await _emit_event(
            http,
            agent_id=agent_id,
            run_id=run_id,
            headers=headers,
            seq=seq,
            event_type="log",
            data={
                "message": "browser_frame",
                "tool": name,
                "label": browser_action_label(name, params),
                **frame,  # {'mime': 'image/png', 'image_base64': '...'}
            },
        )
```

### Problems

1. **Sleep is hardcoded to 350ms** - same for all tools regardless of actual need
2. **No adaptive timing** - heavy pages may need 500ms+, light pages only 100ms
3. **Applies to ALL tools** including read-only (axtree, extract) that don't change page
4. **Synchronous with tool execution** - frame captured AFTER tool, blocking next tool

### Solution: Selective, Adaptive Frame Capture

```python
# cloud_browser_runtime.py (add this)

# Mutation tools that actually change the page
MUTATION_TOOLS = frozenset({
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_ab_open",
    "browser_ab_click",
    "browser_ab_fill",
})

# Read-only tools that don't require frame capture
READ_ONLY_TOOLS = frozenset({
    "browser_extract",
    "browser_axtree",
    "browser_ab_get",
    "browser_ab_is",
})

def needs_frame_capture(tool_name: str) -> bool:
    """Only capture frames for mutation tools."""
    resolved = resolve_tool_name(tool_name)
    return resolved in MUTATION_TOOLS


def adaptive_settle_time(tool_name: str) -> float:
    """Return settle time based on tool type."""
    resolved = resolve_tool_name(tool_name)
    
    if resolved == "browser_ab_open" or tool_name == "browser_navigate":
        return 0.5  # navigation needs longest
    if resolved in ("browser_ab_click", "browser_ab_fill") or tool_name in ("browser_click", "browser_type"):
        return 0.15  # clicks/typing settle faster
    if resolved == "browser_ab_screenshot" or tool_name == "browser_screenshot":
        return 0.0  # already capturing
    
    return 0.0  # default: no settle needed
```

**Refactored frame capture in cloud_runner.py:**

```python
# Parallel execution with selective frame capture
async def _execute_with_frame(
    tc: dict, identity: AgentIdentity, http: QlixHttpClient, ...
) -> tuple[str, str]:
    """Execute tool and conditionally capture frame."""
    tid, tool_out, tc_data = await _execute_tool_call(tc, identity)
    
    if tid and tool_out:
        tool_name = str(tc.get("function", {}).get("name", ""))
        
        # Only capture if it's a mutation tool
        if needs_frame_capture(tool_name):
            # Adaptive settle time
            settle_ms = adaptive_settle_time(tool_name) * 1000
            if settle_ms > 0:
                await asyncio.sleep(settle_ms / 1000)
            
            frame = await asyncio.to_thread(capture_browser_frame_for_ui)
            if frame:
                try:
                    args = json.loads(str(tc.get("function", {}).get("arguments", ""))) or {}
                except:
                    args = {}
                
                await _emit_event(
                    http, ...,
                    event_type="log",
                    data={
                        "message": "browser_frame",
                        "tool": tool_name,
                        "label": browser_action_label(tool_name, args),
                        **frame,
                    },
                )
    
    return tid, tool_out

# In main loop:
execution_tasks = [
    _execute_with_frame(tc, identity, http, ...) for tc in tc_list
]
results = await asyncio.gather(*execution_tasks, return_exceptions=False)
```

**Expected improvements:**
- Skip frame capture for 2-3 tools per round (axtree, extract)
- Reduce settle time from 350ms → 100-150ms average
- **Total: 40-50% reduction in frame overhead (350ms → 150-200ms per mutation)**

---

## BOTTLENECK 4: Browser Tool Execution Overhead

### Current Code (cloud_browser_runtime.py:234-279)

```python
def execute_browser_tool_sync(tool_name: str, arguments_json: str, identity: AgentIdentity) -> str:
    original_name = tool_name
    tool_name = resolve_tool_name(tool_name)
    
    # ... logging ...
    
    if not tool_allowed_for_identity(original_name, identity):
        return f"Tool '{original_name}' denied: ..."
    
    try:
        params = json.loads(arguments_json) if arguments_json.strip() else {}
        if not isinstance(params, dict):
            params = {}
    except json.JSONDecodeError as exc:
        return f"Invalid tool arguments JSON: {exc}"
    
    if original_name != tool_name:
        params = _remap_legacy_params(original_name, tool_name, params)
    
    try:
        if _use_agent_browser_suite() and (
            tool_name.startswith("browser_ab_") or tool_name == "browser_exec"
        ):
            from qlix.luna.browser.agent_browser_cli import run_agent_browser_tool
            
            ok, content = run_agent_browser_tool(
                tool_name,
                params,
                granted_scopes=_effective_granted_scopes(identity),
            )
            return ("" if ok else "[failed] ") + content
        
        cls = ToolRegistry.get(tool_name)  # ← RUNTIME LOOKUP
        result = cls().execute(**params)    # ← INSTANTIATE EACH TIME
        return ("" if result.success else "[failed] ") + (result.content or "")
    
    except KeyError:
        return f"Unknown tool: {original_name}"
    except Exception as exc:
        logger.exception("tool_execute_error %s", tool_name)
        return f"Tool error ({tool_name}): {exc}"
```

### Problems

1. **Registry lookup on hot path** - `ToolRegistry.get(tool_name)` at line 272
2. **Instantiation on every call** - `cls()` creates fresh instance each time
3. **Multiple conditional branches** - legacy remapping, agent-browser check
4. **Subprocess calls happen at tool level** - each tool call → agent-browser subprocess

### Solution: Pre-Bind Tool Executors at Session Start

```python
# cloud_runtime.py:86-93 (in _run_backend_proxy_inference)

# NEW: Pre-compile tool executors at start of inference session
def _build_tool_executor_map(
    identity: AgentIdentity,
    selected_skills: list[str] | None,
) -> dict[str, Callable]:
    """Pre-bind all tools once, reuse executors throughout session."""
    from qlix.luna.cloud_browser_runtime import (
        resolve_tool_name,
        _use_agent_browser_suite,
        _remap_legacy_params,
        _effective_granted_scopes,
    )
    
    executor_map: dict[str, Callable] = {}
    tools_list = openai_browser_tool_definitions(identity, selected_skills)
    
    for tool_def in tools_list:
        tool_name = tool_def["function"]["name"]
        original_name = tool_name
        resolved_name = resolve_tool_name(tool_name)
        
        # Pre-resolve which execution path this tool uses
        use_agent_browser = (
            _use_agent_browser_suite() and
            (resolved_name.startswith("browser_ab_") or resolved_name == "browser_exec")
        )
        
        if use_agent_browser:
            from qlix.luna.browser.agent_browser_cli import run_agent_browser_tool
            
            def _execute_agent_browser(
                args_json: str,
                name=resolved_name,
                scopes=_effective_granted_scopes(identity),
            ):
                params = json.loads(args_json) if args_json.strip() else {}
                ok, content = run_agent_browser_tool(name, params, scopes)
                return ("" if ok else "[failed] ") + content
            
            executor_map[original_name] = _execute_agent_browser
        else:
            from qlix.luna.core.registry import ToolRegistry
            
            tool_cls = ToolRegistry.get(resolved_name)  # Lookup ONCE
            tool_instance = tool_cls()  # Instantiate ONCE per session
            
            def _execute_legacy(
                args_json: str,
                tool_inst=tool_instance,
                orig=original_name,
                resolved=resolved_name,
            ):
                params = json.loads(args_json) if args_json.strip() else {}
                if orig != resolved:
                    params = _remap_legacy_params(orig, resolved, params)
                result = tool_inst.execute(**params)
                return ("" if result.success else "[failed] ") + (result.content or "")
            
            executor_map[original_name] = _execute_legacy
    
    return executor_map


# Modified tool execution in main loop
async def _run_backend_proxy_inference(...):
    tools = openai_browser_tool_definitions(identity, selected_skills)
    tool_executors = _build_tool_executor_map(identity, selected_skills)  # NEW
    
    for round_idx in range(max_rounds):
        # ... model call ...
        
        for tc in tc_list:
            name = str(fn.get("name", ""))
            args = str(fn.get("arguments", ""))
            
            # Use pre-bound executor instead of lookup
            executor = tool_executors.get(name)
            if executor:
                tool_out = await asyncio.to_thread(executor, args)
            else:
                tool_out = f"Unknown tool: {name}"
            
            messages.append({"role": "tool", ...})
```

**Expected improvement:**
- Eliminate 36+ `ToolRegistry.get()` lookups per 12-round run
- Pre-instantiate tools once instead of 36 times
- ~5-10ms per tool execution saved
- **Total: 180-360ms saved on tool dispatch alone**

---

## BOTTLENECK 5: Tool Result Truncation

### Current Code (cloud_runner.py:183)

```python
messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})
```

**Plus in tool implementations:**
- `browser.py:104-105` - navigate: 5,000 chars
- `browser.py:406, 422, 438` - extract: 10,000 chars
- `browser_axtree.py` - no limit but can be 50K+ nodes

### Problem

1. **Multiple truncation layers** - unpredictable final size
2. **Hard limits** - accessibility tree loses structure if >50K nodes
3. **No context to model** - model doesn't know it got truncated
4. **Aggressive for axtree** - accessibility tree is structured data that should stream

### Solution: Deferred Truncation + Streaming for Large Results

```python
# cloud_browser_runtime.py - add to tool result

def execute_browser_tool_sync_with_size_hint(
    tool_name: str,
    arguments_json: str,
    identity: AgentIdentity,
) -> tuple[str, int]:
    """Execute tool, return (result, original_size) for size-aware truncation."""
    original_name = tool_name
    tool_name = resolve_tool_name(tool_name)
    
    # ... existing logic ...
    
    try:
        # ... existing execution ...
        result = cls().execute(**params)
        content = result.content or ""
        
        # Return content + metadata about truncation
        return content, len(content)
    
    except Exception as exc:
        return str(exc), 0


# In cloud_runner.py - smart truncation

async def _execute_tool_call(tc: dict, identity: AgentIdentity):
    # ... existing code ...
    
    tool_out, original_size = await asyncio.to_thread(
        execute_browser_tool_sync_with_size_hint, name, args, identity
    )
    
    # Size-aware truncation for different tools
    if name == "browser_axtree" or name == "browser_ab_snapshot":
        # Accessibility tree should preserve structure
        # Truncate per-line instead of per-character
        max_lines = 500  # ≈ 5K tokens
        lines = tool_out.split('\n')
        if len(lines) > max_lines:
            tool_out = '\n'.join(lines[:max_lines]) + f"\n\n[AX tree truncated: {len(lines)} total nodes]"
    
    elif name in ("browser_extract", "browser_ab_get"):
        # Text extraction - truncate to paragraph boundaries
        max_chars = 10_000
        if len(tool_out) > max_chars:
            tool_out = tool_out[:max_chars] + f"\n\n[Content truncated from {len(tool_out)} chars]"
    
    else:
        # Default: 120K (as before)
        max_chars = 120_000
        if len(tool_out) > max_chars:
            tool_out = tool_out[:max_chars] + f"\n\n[Output truncated]"
    
    messages.append({
        "role": "tool",
        "tool_call_id": tid,
        "content": tool_out,
        "metadata": {
            "tool_name": name,
            "original_size": original_size,
            "truncated": original_size > len(tool_out),
        }
    })
```

**Expected improvement:**
- Preserve page structure for axtree (important for agent decisions)
- Clear truncation hints so model understands partial results
- ~10-20% better context preservation for large pages

---

## Implementation Priority & Effort

| Bottleneck | Effort | Tokens/Latency Saved | Priority |
|---|---|---|---|
| Tool schema caching | 4h | 5.5K tokens/run | **P0** |
| Parallel tool execution | 2h | 1-2s latency | **P0** |
| Selective frame capture | 1h | 150-200ms | **P1** |
| Tool executor pre-binding | 2h | 180-360ms | **P1** |
| Smart truncation | 2h | Better context | **P2** |

---

## Phase 1: Quick Wins (4-6 hours)

**Goal:** 2-3x latency improvement + 5K token savings

1. **Parallel Tool Execution** (2h)
   - Refactor lines 172-196 in cloud_runner.py
   - Use `asyncio.gather()` for tool execution
   - Expected: **1-2s latency savings**

2. **Selective Frame Capture** (1h)
   - Add `needs_frame_capture()` filter
   - Implement adaptive settle time
   - Expected: **150-200ms savings**

3. **Tool Schema Caching** (2-3h)
   - Add `tools_hash` tracking
   - Modify backend_inference_client.py to support optional tools
   - Expected: **5.5K token savings per 12-round run**

---

## Phase 2: Medium Effort (4-6 hours)

4. **Pre-bind Tool Executors** (2h)
   - Create `_build_tool_executor_map()`
   - Call once per session
   - Expected: **180-360ms savings**

5. **Smart Result Truncation** (2h)
   - Implement size-aware truncation
   - Add truncation metadata
   - Expected: **Better context preservation**

---

## Testing & Validation

```python
# In cloud_runner.py - add telemetry
_log("optimization_metrics", {
    "total_rounds": inference_rounds,
    "total_tool_calls": len(tool_names_ran),
    "parallel_tool_groups": num_parallel_groups,
    "frame_captures_skipped": skipped_frames,
    "schema_bytes_saved": schema_savings,
    "tool_dispatch_ms": dispatch_time_ms,
    "avg_tool_latency_ms": avg_tool_latency,
})
```

Benchmark improvements:
- Before: 12 rounds × 3 tools = **~7-10 seconds total latency**
- After Phase 1: **~3-4 seconds** (60-70% improvement)
- After Phase 2: **~2-3 seconds** (70-80% improvement)
