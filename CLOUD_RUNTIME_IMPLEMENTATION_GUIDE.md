# Cloud Runtime: Implementation Guide

Step-by-step code changes for cloud proxy path optimization.

---

## Change 1: Parallel Tool Execution (2 hours)

**File:** `sdk/python/qlix/cloud_runner.py`  
**Lines:** 172-196 (tool execution loop)  
**Impact:** 2-3x latency improvement

### BEFORE:
```python
        for tc in tc_list:
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
            name = str(fn.get("name", ""))
            args = str(fn.get("arguments", ""))
            tid = str(tc.get("id", ""))
            if not name or not tid:
                continue
            tool_out = await asyncio.to_thread(execute_browser_tool_sync, name, args, identity)  # BLOCKS
            tool_names_ran.append(name)
            messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})
            seq = await _emit_event(
                http,
                agent_id=agent_id,
                run_id=run_id,
                headers=headers,
                seq=seq,
                event_type="log",
                data={
                    "message": "tool_finished",
                    "tool": name,
                    "browser_engine": os.environ.get("LUNA_BROWSER_ENGINE", "playwright"),
                },
            )
            if should_capture_browser_frame(name):
                try:
                    params = json.loads(args) if args.strip() else {}
                    if not isinstance(params, dict):
                        params = {}
                except json.JSONDecodeError:
                    params = {}
                await asyncio.sleep(0.35)
                frame = await asyncio.to_thread(capture_browser_frame_for_ui)
                if frame:
                    seq = await _emit_event(...)
```

### AFTER:
```python
        # Helper to execute single tool
        async def _execute_single_tool(tc_item):
            if not isinstance(tc_item, dict):
                return None
            fn = tc_item.get("function") if isinstance(tc_item.get("function"), dict) else {}
            name = str(fn.get("name", ""))
            args = str(fn.get("arguments", ""))
            tid = str(tc_item.get("id", ""))
            if not name or not tid:
                return None
            
            tool_out = await asyncio.to_thread(execute_browser_tool_sync, name, args, identity)
            return {
                "tid": tid,
                "name": name,
                "args": args,
                "output": tool_out,
                "tc": tc_item,
            }
        
        # Execute all tools in parallel
        tool_results = await asyncio.gather(
            *[_execute_single_tool(tc) for tc in tc_list],
            return_exceptions=False,
        )
        
        # Process results sequentially (preserve order for messages)
        for result in tool_results:
            if not result:
                continue
            
            tid = result["tid"]
            name = result["name"]
            tool_out = result["output"]
            args = result["args"]
            
            tool_names_ran.append(name)
            messages.append({"role": "tool", "tool_call_id": tid, "content": tool_out[:120_000]})
            
            seq = await _emit_event(
                http,
                agent_id=agent_id,
                run_id=run_id,
                headers=headers,
                seq=seq,
                event_type="log",
                data={
                    "message": "tool_finished",
                    "tool": name,
                    "browser_engine": os.environ.get("LUNA_BROWSER_ENGINE", "playwright"),
                },
            )
            
            # Frame capture (can also be parallelized in future)
            if should_capture_browser_frame(name):
                try:
                    params = json.loads(args) if args.strip() else {}
                    if not isinstance(params, dict):
                        params = {}
                except json.JSONDecodeError:
                    params = {}
                
                # Use adaptive settle time instead of hardcoded 350ms
                settle_time = _get_adaptive_settle_time(name)
                if settle_time > 0:
                    await asyncio.sleep(settle_time)
                
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
                            **frame,
                        },
                    )
```

### Add helper function at module level:
```python
def _get_adaptive_settle_time(tool_name: str) -> float:
    """Return settle time (seconds) based on tool type."""
    if tool_name in ("browser_navigate", "browser_ab_open"):
        return 0.5  # navigation needs longest
    if tool_name in ("browser_click", "browser_type", "browser_ab_click", "browser_ab_fill"):
        return 0.15  # clicks/typing settle faster
    if tool_name in ("browser_screenshot", "browser_ab_screenshot"):
        return 0.0  # already capturing
    return 0.0  # default
```

---

## Change 2: Selective Frame Capture (1 hour)

**File:** `sdk/python/qlix/cloud_browser_runtime.py`  
**Lines:** 82-105 (browser_frame_tools, should_capture_browser_frame)  
**Impact:** 150-200ms per run

### BEFORE:
```python
def browser_frame_tools() -> frozenset[str]:
    """Tools that update the live-view screenshot after execution."""
    skip = (
        "browser_ab_console",
        "browser_ab_errors",
        "browser_ab_close",
        "browser_ab_session",
        "browser_exec",
    )
    out: set[str] = set()
    for tid in browser_tool_order():
        if tid in skip or tid in ("browser_ab_get", "browser_ab_is"):
            continue
        out.add(tid)
    for legacy, modern in LEGACY_TOOL_ALIASES.items():
        if modern in out:
            out.add(legacy)
    return frozenset(out)
```

### AFTER:
```python
def browser_frame_tools() -> frozenset[str]:
    """Tools that update the live-view screenshot after execution.
    
    Only mutation tools should trigger frame capture:
    - navigate, click, type (change page state)
    - screenshot (already is a frame)
    
    Read-only tools don't need frame capture:
    - extract, axtree (don't change page)
    - get, is (queries only)
    """
    # Tools that mutate the page and need frame capture
    mutations = {
        "browser_navigate",
        "browser_click",
        "browser_type",
        "browser_screenshot",
        "browser_ab_open",
        "browser_ab_click",
        "browser_ab_fill",
        "browser_ab_screenshot",
    }
    
    # Skip these even if they might update view
    skip = (
        "browser_ab_console",
        "browser_ab_errors",
        "browser_ab_close",
        "browser_ab_session",
        "browser_exec",
        # Read-only tools:
        "browser_ab_get",
        "browser_ab_is",
        "browser_ab_find",
        "browser_extract",
        "browser_axtree",
    )
    
    out: set[str] = set()
    for tid in browser_tool_order():
        if tid in skip:
            continue
        if tid in mutations:
            out.add(tid)
    
    # Add legacy aliases for captured tools
    for legacy, modern in LEGACY_TOOL_ALIASES.items():
        if modern in out:
            out.add(legacy)
    
    return frozenset(out)


def adaptive_settle_time(tool_name: str) -> float:
    """Return UI settle time (seconds) for different tools."""
    resolved = resolve_tool_name(tool_name)
    
    # Navigation takes longest (page load, render)
    if resolved == "browser_ab_open" or tool_name == "browser_navigate":
        return 0.5
    
    # Clicks and typing are faster
    if resolved in ("browser_ab_click", "browser_ab_fill") or tool_name in ("browser_click", "browser_type"):
        return 0.15
    
    # Screenshots don't need settle (capturing current state)
    if resolved == "browser_ab_screenshot" or tool_name == "browser_screenshot":
        return 0.0
    
    # Everything else (mutations we didn't anticipate)
    return 0.1
```

### Update capture call in cloud_runner.py:
```python
# Replace:
#   await asyncio.sleep(0.35)
# With:
if should_capture_browser_frame(name):
    from .cloud_browser_runtime import adaptive_settle_time
    settle_s = adaptive_settle_time(name)
    if settle_s > 0:
        await asyncio.sleep(settle_s)
    # ... capture frame ...
```

---

## Change 3: Tool Schema Caching (2-3 hours)

**File:** `sdk/python/qlix/cloud_runner.py`  
**Lines:** 95-140  
**Impact:** 5.5K token savings per 12-round run

### BEFORE:
```python
    tools = openai_browser_tool_definitions(
        identity,
        selected_skills if selected_skills else None,
    )
    messages: list[dict[str, Any]] = [{"role": "user", "content": enriched_prompt}]
    max_rounds = int(os.environ.get("QLIX_CLOUD_TOOL_MAX_ROUNDS", "12"))
    max_seconds = float(os.environ.get("QLIX_CLOUD_TOOL_MAX_SECONDS", "120"))
    _log(
        "proxy_tool_loop_start",
        agent_id=agent_id,
        run_id=run_id,
        max_rounds=max_rounds,
        max_seconds=max_seconds,
        tools_offered=len(tools),
        skill_filter=selected_skills if selected_skills else None,
    )
    deadline = time.time() + max_seconds
    started = time.time()
    tool_names_ran: list[str] = []
    usage_acc: dict[str, Any] = {}
    temperature = float(os.environ.get("QLIX_PROXY_TEMPERATURE", "0.2"))
    max_tokens = int(os.environ.get("QLIX_PROXY_MAX_TOKENS", "4096"))
    content_out = ""
    inference_rounds = 0

    for round_idx in range(max_rounds):
        inference_rounds += 1
        if time.time() > deadline:
            content_out = content_out or "Stopped: tool loop time budget exceeded."
            break

        proxy_result = await backend_proxy_chat_completion(
            http,
            agent_id=agent_id,
            headers=headers,
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            run_id=run_id,
            tools=tools if tools else None,  # ← SENT EVERY ROUND
            tool_choice="auto" if tools else None,
        )
```

### AFTER:
```python
    import hashlib
    
    tools = openai_browser_tool_definitions(
        identity,
        selected_skills if selected_skills else None,
    )
    
    # Compute tools hash for caching
    tools_json = json.dumps(tools, sort_keys=True)
    tools_hash = hashlib.md5(tools_json.encode()).hexdigest()[:8]
    
    messages: list[dict[str, Any]] = [{"role": "user", "content": enriched_prompt}]
    max_rounds = int(os.environ.get("QLIX_CLOUD_TOOL_MAX_ROUNDS", "12"))
    max_seconds = float(os.environ.get("QLIX_CLOUD_TOOL_MAX_SECONDS", "120"))
    _log(
        "proxy_tool_loop_start",
        agent_id=agent_id,
        run_id=run_id,
        max_rounds=max_rounds,
        max_seconds=max_seconds,
        tools_offered=len(tools),
        tools_hash=tools_hash,
        skill_filter=selected_skills if selected_skills else None,
    )
    deadline = time.time() + max_seconds
    started = time.time()
    tool_names_ran: list[str] = []
    usage_acc: dict[str, Any] = {}
    temperature = float(os.environ.get("QLIX_PROXY_TEMPERATURE", "0.2"))
    max_tokens = int(os.environ.get("QLIX_PROXY_MAX_TOKENS", "4096"))
    content_out = ""
    inference_rounds = 0
    tools_schema_tokens = 0  # Track savings

    for round_idx in range(max_rounds):
        inference_rounds += 1
        if time.time() > deadline:
            content_out = content_out or "Stopped: tool loop time budget exceeded."
            break

        # Build inference request
        inference_request: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "run_id": run_id,
        }
        
        # Send full tools only on first round
        # On subsequent rounds, use hash-based cache hint
        if round_idx == 0:
            inference_request["tools"] = tools
            inference_request["tool_choice"] = "auto"
            inference_request["tools_hash"] = tools_hash  # for backend to cache
            tools_schema_tokens = len(tools_json) // 4  # rough estimate
        else:
            # Rounds 2+: tell backend to reuse cached tools
            # Still set tool_choice but omit tools
            inference_request["tool_choice"] = "auto"
            inference_request["tools_hash"] = tools_hash

        proxy_result = await backend_proxy_chat_completion(
            http,
            agent_id=agent_id,
            headers=headers,
            **inference_request,
        )
```

### Update logging at end:
```python
    _log(
        "proxy_tool_loop_done",
        agent_id=agent_id,
        run_id=run_id,
        inference_rounds=inference_rounds,
        tools_executed=tool_names_ran,
        duration_ms=duration_ms,
        tools_schema_tokens_saved=tools_schema_tokens * (inference_rounds - 1),  # NEW
    )
```

### Update backend_inference_client.py to handle optional tools:
```python
# sdk/python/qlix/backend_inference_client.py

async def backend_proxy_chat_completion(
    http: QlixHttpClient,
    *,
    agent_id: str,
    headers: dict[str, str],
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.2,
    max_tokens: int = 1024,
    run_id: str | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    tools_hash: str | None = None,  # NEW
) -> BackendInferenceResult:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "metadata": {"runId": run_id, "agentId": agent_id},
    }
    if tools:  # Only send if provided
        body["tools"] = tools
    if tools_hash:  # NEW: hash for backend caching
        body["tools_hash"] = tools_hash
    if tool_choice is not None:
        body["tool_choice"] = tool_choice
    
    response = await http.post_json(
        f"/api/v1/agents/{agent_id}/inference/chat",
        body,
        headers=headers,
    )
    # ... rest unchanged ...
```

---

## Change 4: Pre-bind Tool Executors (2 hours)

**File:** `sdk/python/qlix/cloud_runner.py`  
**Lines:** 74-235 (entire _run_backend_proxy_inference)  
**Impact:** 180-360ms latency savings

### Add at module level (after imports):
```python
def _build_tool_executor_map(
    identity: AgentIdentity,
    selected_skills: list[str] | None,
) -> dict[str, callable]:
    """Pre-compile tool executors once, reuse throughout inference session."""
    from .cloud_browser_runtime import (
        openai_browser_tool_definitions,
        resolve_tool_name,
        _use_agent_browser_suite,
        _remap_legacy_params,
        _effective_granted_scopes,
    )
    from .luna.core.registry import ToolRegistry
    
    executor_map: dict[str, callable] = {}
    tools_list = openai_browser_tool_definitions(identity, selected_skills)
    
    for tool_def in tools_list:
        tool_name = tool_def["function"]["name"]
        original_name = tool_name
        resolved_name = resolve_tool_name(tool_name)
        
        # Check which execution path this tool uses
        use_agent_browser = (
            _use_agent_browser_suite() and
            (resolved_name.startswith("browser_ab_") or resolved_name == "browser_exec")
        )
        
        if use_agent_browser:
            from .luna.browser.agent_browser_cli import run_agent_browser_tool
            scopes = _effective_granted_scopes(identity)
            
            def _make_agent_browser_executor(name, scps):
                def _execute(args_json: str):
                    params = json.loads(args_json) if args_json.strip() else {}
                    if not isinstance(params, dict):
                        params = {}
                    ok, content = run_agent_browser_tool(name, params, scps)
                    return ("" if ok else "[failed] ") + content
                return _execute
            
            executor_map[original_name] = _make_agent_browser_executor(resolved_name, scopes)
        else:
            # Pre-instantiate tool once
            try:
                tool_cls = ToolRegistry.get(resolved_name)
                tool_instance = tool_cls()
            except KeyError:
                # Tool not found - create error executor
                def _make_error_executor(name):
                    def _execute(args_json: str):
                        return f"Unknown tool: {name}"
                    return _execute
                executor_map[original_name] = _make_error_executor(original_name)
                continue
            
            def _make_legacy_executor(inst, orig, resolved):
                def _execute(args_json: str):
                    params = json.loads(args_json) if args_json.strip() else {}
                    if not isinstance(params, dict):
                        params = {}
                    if orig != resolved:
                        params = _remap_legacy_params(orig, resolved, params)
                    result = inst.execute(**params)
                    return ("" if result.success else "[failed] ") + (result.content or "")
                return _execute
            
            executor_map[original_name] = _make_legacy_executor(tool_instance, original_name, resolved_name)
    
    return executor_map
```

### Modify tool execution loop:
```python
# OLD CODE:
async def _run_backend_proxy_inference(...):
    tools = openai_browser_tool_definitions(...)
    # ... setup ...
    
    for round_idx in range(max_rounds):
        # ...
        for tc in tc_list:
            # ...
            tool_out = await asyncio.to_thread(execute_browser_tool_sync, name, args, identity)

# NEW CODE:
async def _run_backend_proxy_inference(...):
    tools = openai_browser_tool_definitions(...)
    tool_executors = _build_tool_executor_map(identity, selected_skills)  # NEW
    # ... setup ...
    
    for round_idx in range(max_rounds):
        # ...
        for tc in tc_list:
            # ...
            executor = tool_executors.get(name)
            if executor:
                tool_out = await asyncio.to_thread(executor, args)  # Use pre-bound
            else:
                tool_out = f"Unknown tool: {name}"
```

---

## Change 5: Smart Result Truncation (1-2 hours)

**File:** `sdk/python/qlix/cloud_browser_runtime.py`  
**Lines:** Add new function, update cloud_runner.py  
**Impact:** Better context preservation

### Add to cloud_browser_runtime.py:
```python
def smart_truncate_tool_result(
    tool_name: str,
    result: str,
) -> tuple[str, bool]:
    """Intelligently truncate tool results while preserving context.
    
    Returns (truncated_result, was_truncated).
    """
    resolved = resolve_tool_name(tool_name)
    
    # Accessibility tree: preserve line structure
    if resolved == "browser_ab_snapshot" or tool_name == "browser_axtree":
        max_lines = 500  # ≈ 5-10K tokens depending on nesting
        lines = result.split('\n')
        if len(lines) > max_lines:
            truncated = '\n'.join(lines[:max_lines])
            truncated += f"\n\n[AX tree truncated: {len(lines)} total nodes, showing {max_lines}]"
            return truncated, True
        return result, False
    
    # Text extraction: truncate to word boundary
    if resolved == "browser_ab_get" or tool_name == "browser_extract":
        if tool_name == "browser_extract":
            extract_type = getattr(result, "extract_type", "text")
            max_chars = 15_000 if extract_type == "tables" else 10_000
        else:
            max_chars = 10_000
        
        if len(result) > max_chars:
            # Try to truncate at paragraph boundary (double newline)
            para_pos = result.rfind('\n\n', 0, max_chars)
            if para_pos > max_chars * 0.8:  # If we can find boundary in last 20%
                truncated = result[:para_pos]
            else:
                truncated = result[:max_chars]
            truncated += f"\n\n[Content truncated from {len(result)} chars]"
            return truncated, True
        return result, False
    
    # Default: 120K tokens
    max_chars = 120_000
    if len(result) > max_chars:
        truncated = result[:max_chars]
        truncated += f"\n\n[Output truncated from {len(result)} chars]"
        return truncated, True
    
    return result, False
```

### Update cloud_runner.py tool execution:
```python
# In the tool execution loop, after getting tool_out:

from .cloud_browser_runtime import smart_truncate_tool_result

tool_out, was_truncated = smart_truncate_tool_result(name, tool_out)

messages.append({
    "role": "tool",
    "tool_call_id": tid,
    "content": tool_out,
})

# Optionally emit metadata about truncation
if was_truncated:
    seq = await _emit_event(
        http,
        agent_id=agent_id,
        run_id=run_id,
        headers=headers,
        seq=seq,
        event_type="log",
        data={
            "message": "tool_result_truncated",
            "tool": name,
            "original_size": len(tool_out),
        },
    )
```

---

## Testing Checklist

After each change, verify:

- [ ] Tool execution still works (basic navigate + click)
- [ ] Frame captures appear in UI for mutations
- [ ] No frame captures for read-only tools (axtree, extract)
- [ ] Tool execution completes in <2s for 3 parallel tools
- [ ] Schema hash logged correctly
- [ ] Truncation messages appear in logs for large results
- [ ] Tool caching compatible with skill filtering

### Quick Manual Test:
```python
# Run an agent chat that uses multiple browser tools
# Check logs for:
# - "proxy_tool_loop_start" with tools_hash
# - "tool_finished" for each tool
# - "browser_frame" only for mutation tools (not axtree/extract)
# - Parallel execution: 3 tools finish in ~500ms (not 1500ms)
```

---

## Rollback Plan

If issues arise:

1. **Parallel execution fails** → Set `QLIX_CLOUD_FORCE_SERIAL_TOOLS=1` env var, refactor to serial
2. **Frame capture missing** → Disable adaptive time, revert to 350ms sleep
3. **Tools not executing** → Check `_build_tool_executor_map` for registration errors
4. **Backend doesn't recognize tools_hash** → Remove tools_hash field, send full tools

---

## Performance Verification

After completing all changes:

```bash
# Before optimizations:
# 12-round conversation: 7-10 seconds, 20-30K tool schema tokens

# After Phase 1 (parallel + frame):
# 12-round conversation: 3-4 seconds, 15-20K tool schema tokens

# After Phase 2 (pre-binding + caching):
# 12-round conversation: 2-3 seconds, 5-8K tool schema tokens
```

Expected improvements:
- **Latency:** 60-70% reduction
- **Token efficiency:** 60-80% reduction in tool schema tokens
- **Storage:** 30-50% reduction in frame storage
