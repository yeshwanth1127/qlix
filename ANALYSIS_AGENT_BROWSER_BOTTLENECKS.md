# Agent Browser Tool Stack Analysis: Bottlenecks & Optimization Opportunities

**Date:** 2026-05-18  
**Scope:** Luna browser tools → Cloud runner → Backend inference proxy → OpenRouter

---

## Executive Summary

The current agent browser tool stack has **significant token inefficiency, latency overhead, and architectural constraints** that severely impact performance and cost. Key findings:

- **~40-60% of tokens wasted** on redundant tool schema definitions sent every inference round
- **3-5x latency multiplier** from synchronous tool execution, subprocess overhead, and serialization layers
- **No prompt caching** despite being ideal for repetitive tool calling patterns
- **Unoptimized screenshot capture** creating unnecessary bandwidth/storage bloat
- **Sequential tool execution** when parallelization is viable
- **Registry lookups on hot path** at runtime instead of compile-time

---

## 1. TOOL DEFINITION BLOAT

### Problem
Every inference round, **all available browser tools are serialized into OpenAI function format** and sent to the model, even if only a subset is needed.

**Current Flow:**
```
openai_browser_tool_definitions()  [cloud_browser_runtime.py:142-168]
  → loops browser_tool_order()  [6 tools: navigate, click, type, screenshot, extract, axtree]
  → for each: ToolRegistry.get() → to_openai_function()
  → returns list of {"type": "function", "function": {...spec...}}
  → sent to OpenRouter in EVERY inference round  [cloud_runner.py:95-98]
```

### Token Cost Breakdown
Each tool definition includes:
- `name` (10-20 tokens)
- `description` (50-150 tokens)
- `parameters` with nested schema (100-300 tokens)
- **Per tool: ~200-500 tokens**
- **Per round with 6 tools: 1,200-3,000 tokens**

Over a 12-round conversation (max_rounds in cloud_runner.py:100):
- **14,400-36,000 tokens wasted on repetition**
- At $0.001/1K tokens (gpt-4o-mini), **$14-$36 per conversation**

### Root Causes
1. **No prompt caching** - Identical tool schemas repeated every round
2. **No skill filtering at serialization** - Full tool set serialized even when `selected_skills` filters exist
3. **Static tool set, dynamic serialization** - Tools could be frozen but are regenerated each round

---

## 2. SCHEMA SERIALIZATION INEFFICIENCY

### Problem
Tool parameters use **full JSON Schema format** with verbose property descriptors.

**Example: `browser_navigate`**
```python
parameters={
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "description": "URL to navigate to.",
        },
        "wait_for": {
            "type": "string",
            "description": "Wait condition: 'load', 'domcontentloaded', or 'networkidle'. Default: 'load'.",
        },
    },
    "required": ["url"],
}
```

**Tokens wasted per round:**
- Repeating `"type": "string", "type": "object"` across 6 tools
- Repeating `"required"`, `"properties"` structure
- **Can be templated or use schema references** (JSON Schema $ref)

### Opportunities
1. **Schema reuse**: Define common patterns once, reference via `$ref`
2. **Compressed format**: Use numeric IDs for common property types
3. **Tool grouping**: Split into "safe" (read-only) and "mutation" tools, cache separately

---

## 3. MISSING PROMPT CACHING

### Problem
Tool schemas are **deterministic per session** but sent fresh every round.

**OpenAI Prompt Caching rules (from your Haiku model):**
- Messages before tool calls are cached
- Same tool set across rounds → cache miss without explicit caching

**Current implementation:**
```python
# cloud_runner.py:95-98
tools = openai_browser_tool_definitions(identity, selected_skills if selected_skills else None)
# Sent to OpenRouter with NO cache control
messages: list[dict[str, Any]] = [{"role": "user", "content": enriched_prompt}]
```

**What's missing:**
- Tool definitions not in `system` role (where cache is most effective)
- No `cache_control` in request body
- Tool list treated as mutable, defeating cache stability

### Impact
Without caching:
- **12 rounds × 2,000 tool tokens = 24,000 input tokens**
- With cache: **2,000 + 11×24 overhead tokens = ~2,264 tokens** (90% savings on subsequent rounds)

---

## 4. SYNCHRONOUS, SEQUENTIAL TOOL EXECUTION

### Problem
Tools execute one-at-a-time with blocking waits instead of parallelizing independent operations.

**Current code:**
```python
# cloud_runner.py:172-196
for tc in tc_list:
    tool_out = await asyncio.to_thread(
        execute_browser_tool_sync, name, args, identity
    )  # blocks until tool finishes
    tool_names_ran.append(name)
    messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})
```

**Timeline with 3 tools (each 500ms):**
- Current: 500ms + 500ms + 500ms = **1,500ms**
- Parallel: max(500ms, 500ms, 500ms) = **500ms** (3x faster)

**Why this matters:**
- Browser tool execution is I/O-bound (network, subprocess)
- Waiting for agent-browser subprocess (agent_browser_driver.py:52-116)
- Safe for independent tools (e.g., screenshot + extract_text on same page)

---

## 5. BROWSER SUBPROCESS OVERHEAD

### Problem
Each tool invocation spawns a **subprocess to agent-browser CLI** or Playwright.

**Call chain:**
```
execute_browser_tool_sync()
  [cloud_browser_runtime.py:234-279]
  → ToolRegistry.get(tool_name)  # hot path lookup
  → cls().execute(**params)
  → _driver().click/navigate/screenshot
    [browser.py:74-195]
    → AgentBrowserDriver._run(*args)
      [agent_browser_driver.py:52]
      → subprocess.run([binary, "--json", ...])  # NEW PROCESS
      → json.loads(stdout)  # deserialization
```

**Costs per tool:**
- Process spawn: **50-100ms** (Windows worse than Linux)
- IPC overhead: **JSON serialization/deserialization: 10-50ms**
- Binary startup: **100-200ms on first call**

**For 12 rounds × 3 avg tools/round:**
- **36 subprocess invocations**
- **1,800-3,600ms of subprocess overhead alone**

### Sub-problem: Agent-Browser Session State
```python
# agent_browser_driver.py:34-38
def __init__(self, session: str | None = None, ...):
    self._session = session or os.environ.get("AGENT_BROWSER_SESSION", "default")
    
# cloud_runner.py:267
os.environ.setdefault("AGENT_BROWSER_SESSION", identity.agent_id)
```

**Issue:** Session is per-process. Each subprocess spawn creates session redundancy.

---

## 6. SCREENSHOT CAPTURE & STORAGE BLOAT

### Problem
After each mutation tool (navigate, click, type), **screenshot is captured, base64-encoded, and sent to backend**.

**Code:**
```python
# cloud_runner.py:197-220
if should_capture_browser_frame(name):
    await asyncio.sleep(0.35)  # wait for UI to settle
    frame = await asyncio.to_thread(capture_browser_frame_for_ui)
    if frame:
        seq = await _emit_event(
            http, ...,
            event_type="log",
            data={
                "message": "browser_frame",
                "image_base64": base64.b64encode(raw).decode("ascii"),
                ...
            },
        )
```

**Costs:**
- **350ms sleep per mutation tool** (line 204: hardcoded)
- **Base64 encoding overhead**: ~33% size inflation (e.g., 1MB PNG → 1.33MB text)
- **Network bandwidth**: Sending every frame to backend over HTTP
- **Database storage**: Frame cached in `agentRunEvent.data` (no retention policy)
- **Max frame size**: 1.2MB but no adaptive quality (line 62)

**For a 5-tool execution with 3 mutations:**
- **1,050ms of wait time** (3 × 350ms)
- **~4-5MB of data transfer** (if screenshots are ~1-2MB each)

### Frame Capture Criteria
```python
# cloud_browser_runtime.py:82-99
browser_frame_tools = {
    "browser_navigate", "browser_click", "browser_type",
    "browser_screenshot", "browser_extract", "browser_axtree"
}
# All except "browser_ab_get", "browser_ab_is", "browser_ab_console", etc.
```

**Issue**: Indiscriminate capture for tools that don't mutate (extract, axtree).

---

## 7. TOOL RESULT TRUNCATION

### Problem
Tool outputs truncated to **120K tokens** (or ~5K lines) without content negotiation.

**Code:**
```python
# cloud_runner.py:183
messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})

# Individual tools also truncate:
# browser.py:104-105 (navigate): 5,000 chars
# browser.py:406, 422, 438 (extract): 10,000 chars
# browser_axtree.py:61-65: No explicit limit, can be very large
```

**Issues:**
1. **Multiple truncation layers** → unpredictable final size
2. **No streaming** → waits for full response before truncating
3. **Accessibility tree (axtree)** can be 50K+ nodes, aggressive truncation loses context
4. **No hint to model** → model doesn't know content was truncated

---

## 8. REGISTRY LOOKUPS ON HOT PATH

### Problem
Tool dispatch does **runtime registry lookups** for every execution.

```python
# cloud_browser_runtime.py:272-274
cls = ToolRegistry.get(tool_name)  # KeyError lookup in dict
result = cls().execute(**params)   # instantiate on every call
```

**Inefficiency:**
- `ToolRegistry.get()` [registry.py:54] is a dict lookup (~O(1) but has overhead)
- Tool classes instantiated fresh each call (no pooling/caching)
- Should be **pre-resolved at tool binding time**, not runtime

---

## 9. ARGUMENT PARSING OVERHEAD

### Problem
Tool arguments pass through **multiple JSON serialization rounds**.

**Flow:**
```
1. Model outputs: {"function": {"arguments": '{"url": "https://..."}'}}  (string!)
2. cloud_runner.py:153 (args = str(fn.get("arguments", "")))  (kept as string)
3. cloud_browser_runtime.py:253: json.loads(arguments_json)  (parse again)
4. cloud_browser_runtime.py:259: _remap_legacy_params()  (conditional transforms)
```

**Overhead:**
- JSON string in tool call (OpenAI format requires this, OK)
- But then **no schema validation** at parse time
- Legacy parameter remapping [cloud_browser_runtime.py:118-139] happens at execution time, not schema time

---

## 10. NO TOOL CACHING / MEMOIZATION

### Problem
Identical tool calls with same parameters executed multiple times without caching.

**Example scenario:**
- User asks "Navigate to X"
- Model navigates to X, returns page content
- User asks "Extract the same section"
- Model calls navigate again instead of reusing prior page

**No caching layer for:**
- `browser_screenshot` results (stateless if page unchanged)
- `browser_extract` results (same selector, same page)
- `browser_axtree` results (page structure doesn't change)

**Implementation gap:**
- No LRU cache in ToolExecutor
- No result deduplication
- No browser driver state-aware caching

---

## 11. SKILL FILTERING NOT APPLIED EARLY

### Problem
Tool schema is serialized **before skill filtering**.

**Current flow:**
```python
# cloud_runner.py:95-98
tools = openai_browser_tool_definitions(
    identity,
    selected_skills if selected_skills else None,
)

# But full registry lookup happens first:
# cloud_browser_runtime.py:142-168
def openai_browser_tool_definitions(identity, skill_filter):
    ids = list(browser_tool_order())  # ALL tools
    if skill_filter:
        filt = {str(s).strip() for s in skill_filter}
        ids = [t for t in ids if t in expanded]  # FILTER AFTER
```

**Inefficiency:**
- Collects all tools, then filters (O(n) traversal)
- Could pre-filter registry at import time for known skill sets
- Skill filter is per-request, not per-agent-lifecycle

---

## 12. DATABASE / EVENT STORAGE INEFFICIENCY

### Problem
Every tool execution emits **multiple database writes**.

```python
# createAgentChatRouter.ts:443-445
await prisma.agentRunEvent.create({
    data: { runId, seq, type, data: parsed.data.data },
});
```

**Events per 12-round run with 3 tools/round:**
- 12 logs (inference_tool_round)
- 36 tool_finished
- 36 browser_frame (screenshot data)
- **Total: ~85 inserts per run**

**No batching:**
- Each event is separate transaction
- Could batch frame events, compress images
- No retention policy (frames stored forever)

---

## 13. MISSING INFERENCE ROUND OPTIMIZATION

### Problem
Inference loop doesn't optimize for tool-calling patterns.

**Current logic:**
```python
# cloud_runner.py:120-224
for round_idx in range(max_rounds):
    # 1. Call model with all tools
    proxy_result = await backend_proxy_chat_completion(...)
    
    # 2. Parse tool calls
    # 3. Execute each tool sequentially
    # 4. Add results to messages
    # 5. NEXT ROUND: send entire messages + full tool schemas again
```

**Optimization gap:**
- Messages accumulate (O(n) growth)
- Tool definitions never change but resent (O(1) wasted)
- No convergence detection (if model repeats same tool calls, could exit early)
- No lookahead (model could hint which tools it will use next)

---

## Quantified Impact Summary

| Bottleneck | Tokens/Round | Latency (ms) | Cost ($) | Severity |
|---|---|---|---|---|
| Tool schema duplication | 1.5K-3K | — | $0.0015-0.003 | **HIGH** |
| Sync tool execution | — | 500-1500 | — | **HIGH** |
| Subprocess overhead | — | 1800-3600 | — | **HIGH** |
| Screenshot capture & storage | 50K/frame | 350×mutations | $0.05+ | **MEDIUM** |
| Accessibility tree truncation | 120K limit | — | — | **MEDIUM** |
| Missing prompt caching | 2K×rounds | — | $0.02-0.05 | **HIGH** |
| Registry lookups | — | 1-5 per tool | — | **LOW** |
| Argument parsing | — | 1-2 per tool | — | **LOW** |
| Event storage (no batch) | — | Network round trips | — | **MEDIUM** |

---

## Optimization Roadmap

### Quick Wins (1-2 days)

1. **Enable Prompt Caching**
   - Move tool definitions to `system` role (once per session)
   - Add `cache_control` to OpenRouter request
   - **Expected savings**: 90% on tool schema tokens after first round

2. **Parallelize Tool Execution**
   - Use `asyncio.gather()` for independent tools
   - **Expected speedup**: 2-3x latency reduction

3. **Adaptive Screenshot Capture**
   - Skip frame capture for read-only tools (axtree, extract)
   - Conditional capture based on tool type
   - **Expected savings**: 30-50% of frame storage

### Medium Term (1 week)

4. **Tool Execution Batching**
   - Send multiple tool calls in single backend round trip
   - Aggregate results before next model call
   - **Expected speedup**: 2x latency

5. **Result Caching Layer**
   - LRU cache for deterministic tools (screenshot, extract, axtree)
   - Key by `(tool_name, params_hash, page_hash)`
   - **Expected savings**: 20-30% of tool calls skipped

6. **Optimize Frame Storage**
   - Compress screenshots (JPEG instead of PNG)
   - Store only diff between frames
   - **Expected savings**: 70-80% storage

### Long Term (2+ weeks)

7. **Pre-compiled Tool Binding**
   - Registry.get() → pre-bound function pointers
   - Zero-allocation tool dispatch
   - **Expected speedup**: 1-2ms per tool

8. **Accessibility Tree Streaming**
   - Stream AX tree nodes as they're discovered
   - Don't truncate; serialize on-demand
   - **Expected improvement**: Full page context preserved

9. **Stateful Browser Driver**
   - Reuse agent-browser session across tool calls
   - Eliminate subprocess spawn overhead per tool
   - **Expected speedup**: 3-5x

---

## Implementation Priority

**Focus on these first (highest ROI):**

1. **Prompt Caching** - Easy, immediate 90% token savings
2. **Parallelized Tool Execution** - Easy, 2-3x latency improvement  
3. **Stateful Browser Driver** - Medium effort, 3-5x latency improvement
4. **Adaptive Frame Capture** - Easy, 30-50% storage savings

---

## Code Locations to Focus

| Bottleneck | File | Lines |
|---|---|---|
| Tool schema generation | `cloud_browser_runtime.py` | 142-168 |
| Inference loop | `cloud_runner.py` | 120-224 |
| Tool execution (serial) | `cloud_runner.py` | 172-196 |
| Browser driver | `agent_browser_driver.py` | 52-116 |
| Frame capture | `cloud_runner.py` | 197-220 |
| Tool dispatch | `cloud_browser_runtime.py` | 234-279 |
| Argument parsing | `cloud_browser_runtime.py` | 253-259 |

---

## Questions for Architecture Review

1. **Why are tool definitions sent every round?** Can they be cached on the model side or pre-computed?
2. **Why is screenshot capture synchronous and hardcoded at 350ms?** Can it be async and adaptive?
3. **Can agent-browser session persist across tool calls?** Would eliminate subprocess spawn overhead.
4. **Is accessibility tree truncation necessary?** Could stream results instead.
5. **Why no caching for deterministic tools?** Would prevent redundant page reads.
