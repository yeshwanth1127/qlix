# Complete Testing Guide: All 5 Optimizations

**Goal:** Verify all optimizations work correctly and don't break anything

---

## Quick Smoke Test (5 minutes)

Run this first to check nothing is broken:

```bash
# 1. Start backend
cd backend && npm run dev

# 2. Start cloud runner (in another terminal)
cd sdk/python && python -m qlix.cloud_runner

# 3. Send a simple agent message
curl -X POST http://localhost:3000/api/v1/agents/TEST_AGENT/conversations \
  -H "Authorization: Bearer TOKEN" \
  -d '{}'

# Expected: 201 Created, get conversationId

# 4. Send a message with browser tools
curl -X POST http://localhost:3000/api/v1/agents/TEST_AGENT/conversations/CONVO_ID/messages \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "content": "Navigate to google.com and take a screenshot",
    "skills": ["browser_navigate", "browser_screenshot"]
  }'

# Expected: 201 Created, run starts, completes successfully
```

---

## Test 1: Parallel Tool Execution ⚡

### What to Test
Tools execute simultaneously instead of sequentially

### How to Test

**Setup:**
```bash
# Modify a test to request 3 tools in one round
# In agent prompt: "Take screenshot, then extract text, then read page structure"
```

**Execute:**
```bash
# Run conversation and measure latency
START_TIME=$(date +%s%N)

# Send request that triggers 3 tools in parallel
curl -X POST ... agent message

ELAPSED_MS=$(( ($(date +%s%N) - START_TIME) / 1000000 ))
echo "Elapsed: ${ELAPSED_MS}ms"
```

**Expected Results:**

```
Tool execution latency:
  ❌ BEFORE: 1,500ms (500ms each × 3 sequential)
  ✅ AFTER:  500-700ms (all 3 run in parallel)

Logs should show:
  [cloud_runner] tool_finished tool=browser_screenshot
  [cloud_runner] tool_finished tool=browser_extract
  [cloud_runner] tool_finished tool=browser_axtree
  ^ All three appear within 100-200ms of each other (parallel)
  
  NOT like this (sequential):
  [cloud_runner] tool_finished tool=browser_screenshot ... 500ms
  [cloud_runner] tool_finished tool=browser_extract ... 1000ms
  [cloud_runner] tool_finished tool=browser_axtree ... 1500ms
```

**Automated Check:**
```python
# Extract timestamps from logs
import re
logs = open('cloud_runner.log').read()
matches = re.findall(r'tool_finished.*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})', logs)
times = [datetime.fromisoformat(m) for m in matches]

# Check if tools completed within 200ms of each other (parallel)
time_diffs = [max(times) - min(times) for times in groupby(times)]
if max(time_diffs) < 200:
    print("✅ PASS: Tools executed in parallel")
else:
    print("❌ FAIL: Tools executed sequentially")
```

---

## Test 2: Selective Frame Capture 📸

### What to Test
- Skip screenshots for read-only tools (axtree, extract, get, is)
- Only capture for mutation tools (navigate, click, type, screenshot)
- Adaptive settle time (different delays per tool)

### How to Test

**Setup:**
```bash
# Create a test that uses both mutation and read-only tools
Prompt: "Navigate to google.com, read page structure, type search query, extract results"

Tools used:
  - browser_navigate (mutation) → should capture frame
  - browser_axtree (read-only) → should NOT capture frame
  - browser_type (mutation) → should capture frame
  - browser_extract (read-only) → should NOT capture frame
```

**Execute:**
```bash
curl -X POST ... agent message with above prompt
```

**Check Logs:**
```
Expected pattern:

[cloud_runner] tool_finished tool=browser_navigate
[cloud_runner] browser_frame tool=browser_navigate label="Navigate → google.com"  ✅ FRAME CAPTURED

[cloud_runner] tool_finished tool=browser_axtree
# NO browser_frame event                                                         ✅ NO FRAME (read-only)

[cloud_runner] tool_finished tool=browser_type
[cloud_runner] browser_frame tool=browser_type label="Type..."                   ✅ FRAME CAPTURED

[cloud_runner] tool_finished tool=browser_extract
# NO browser_frame event                                                         ✅ NO FRAME (read-only)
```

**Verify Settle Times:**
```bash
# Check logs for settle time patterns
grep "settle_time" cloud_runner.log

Expected:
  tool=browser_navigate settle_time=0.5s  (navigation longest)
  tool=browser_click settle_time=0.15s    (clicks faster)
  tool=browser_type settle_time=0.15s     (typing faster)
  tool=browser_screenshot settle_time=0.0s (no settle)
```

**Frame Count Verification:**
```bash
# Count frame captures
BEFORE: grep "browser_frame" logs | wc -l  # Expected: 36 (all tools)
AFTER:  grep "browser_frame" logs | wc -l  # Expected: 9-12 (mutations only)
SAVINGS: (36 - 12) / 36 = 67% reduction
```

---

## Test 3: Tool Schema Caching 💾

### What to Test
- Round 1: Backend receives tools + hash, caches them
- Round 2+: Backend receives hash only, looks up cache, re-injects tools
- Tools are always sent to OpenRouter (fresh or cached)

### How to Test

**Setup:**
```bash
# Run a 12-round conversation (hits max_rounds default)
Prompt: "Keep navigating and interacting with the page"

This will trigger:
  Round 1: tools + hash sent
  Round 2-12: hash only (no tools)
```

**Execute:**
```bash
curl -X POST ... agent message with complex prompt that needs 12 rounds
```

**Check Logs for Cache Activity:**

```
Round 1:
  [inference] tools_cached agentId=abc hash=xyz123 count=30
  ✅ Backend cached 30 tools

Round 2:
  [inference] tools_restored agentId=abc hash=xyz123 count=30
  ✅ Backend restored tools from cache
  (No tools in the incoming request!)

Round 3:
  [inference] tools_restored agentId=abc hash=xyz123 count=30
  ✅ Cache hit again

...

Round 12:
  [inference] tools_restored agentId=abc hash=xyz123 count=30
  ✅ 11 cache hits total
```

**Verify Token Savings:**

```
From logs:
  schema_tokens_per_round: 2750  (30 tools × 300 tokens = ~9000 chars ÷ 4)
  schema_tokens_saved: 2750 × 11 = 30,250 tokens saved
  
If this is wrong, check:
  - Backend imports toolCache correctly
  - getCachedTools/cacheToolDefinitions called
  - tools_hash in request schema validated
```

**Test Cache Miss (Edge Case):**

```bash
# Wait 1+ hour (TTL expires), then send same agent_id + old hash
# Expected: logs show
  [inference] tools_cache_miss agentId=abc hash=xyz123 - client must resend
  
# Behavior: OpenRouter gets no tools, model generates text (fallback works)
```

**Network Monitoring:**

```bash
# Monitor bytes sent to OpenRouter API
tcpdump -i any -A 'tcp port 443' | grep -i tool

BEFORE optimization:
  Round 1: Send 30 tools (~9KB)
  Round 2: Send 30 tools (~9KB)  ← WASTED
  Round 3: Send 30 tools (~9KB)  ← WASTED
  ... 12 rounds = ~108KB total

AFTER optimization:
  Round 1: Send 30 tools (~9KB)
  Round 2: Send nothing (~0KB)   ← SAVED
  Round 3: Send nothing (~0KB)   ← SAVED
  ... 12 rounds = ~9KB total
  
  Savings: ~99KB per conversation
```

---

## Test 4: Pre-bound Tool Executors ⚙️

### What to Test
- Tools instantiated once at session start (not 36 times)
- No ToolRegistry lookups during execution
- Faster tool dispatch

### How to Test

**Setup:**
```bash
# Add debug logging to cloud_runner.py
# In _build_tool_executor_map():
print(f"Building executor map: {len(tools)} tools")
for name in executor_map:
    print(f"  Bound: {name}")
```

**Execute:**
```bash
# Run any agent conversation
curl -X POST ... agent message
```

**Check Logs:**

```
Session start (once):
  [cloud_runner] Building executor map: 30 tools
  [cloud_runner]   Bound: browser_ab_open
  [cloud_runner]   Bound: browser_ab_click
  [cloud_runner]   Bound: browser_ab_fill
  ... (all 30 listed)
  ✅ All tools bound once

During execution:
  [cloud_runner] tool_finished tool=browser_click
  [cloud_runner] tool_finished tool=browser_navigate
  (NO "ToolRegistry.get()" calls)
  ✅ Using pre-bound executors (fast)
```

**Performance Baseline:**

```bash
# Measure tool dispatch latency
# Add timer before/after executor call

BEFORE:
  Tool dispatch: 15-20ms per tool (registry lookup + instantiation)
  36 tools × 18ms = 648ms overhead

AFTER:
  Tool dispatch: 1-2ms per tool (direct function call)
  36 tools × 1.5ms = 54ms overhead
  
  Savings: 594ms per conversation
```

---

## Test 5: Smart Result Truncation 🧠

### What to Test
- Accessibility tree truncates at line boundary (not character)
- Text extraction truncates at paragraph boundary
- Other tools use standard truncation
- Truncation messages logged

### How to Test

**Setup:**
```bash
# Create a page with large accessibility tree
# Request: browser_axtree on complex page

# Create page with large text content
# Request: browser_extract on text-heavy page
```

**Execute:**
```bash
curl -X POST ... agent message requesting these tools
```

**Check Results:**

**Accessibility Tree:**
```
Before optimization:
  Page has 5000 nodes
  Show: first 10,000 chars
  Result: Truncated mid-node, structure lost ❌

After optimization:
  Page has 5000 nodes
  Show: first 500 lines
  Result: "[AX tree truncated: 5000 nodes, showing 500]"
  Structure preserved! ✅
```

**Text Extraction:**
```
Before optimization:
  Content: 50,000 chars
  Show: 10,000 chars
  Result: Might cut mid-sentence ❌

After optimization:
  Content: 50,000 chars
  Show: 10,000 chars, but find paragraph boundary
  Result: "[Content truncated from 50000 chars]"
  Cleaner break! ✅
```

**Verify in Logs:**
```
[cloud_runner] tool_finished tool=browser_axtree
[cloud_runner]   truncation_info: lines=5000→500, was_truncated=True

[cloud_runner] tool_finished tool=browser_extract
[cloud_runner]   truncation_info: chars=50000→10000, was_truncated=True
```

---

## Integration Test: Full 12-Round Conversation

### Test Everything Together

**Setup:**
```bash
# Create a comprehensive test scenario
Prompt: "Navigate to complex website, interact with form, read results"

This exercises:
  - Parallel execution (multiple tools per round)
  - Frame capture (mutations only)
  - Schema caching (12 rounds)
  - Pre-bound executors (reused 36 times)
  - Smart truncation (large results)
```

**Execute:**
```bash
# 1. Start monitoring
tail -f cloud_runner.log | grep -E "tool_finished|browser_frame|tools_cached|tools_restored|schema_tokens"

# 2. Send request
curl -X POST ... agent message

# 3. Watch logs in real-time
```

**Expected Timeline:**

```
T=0s:     tools_cached (Round 1 - tools sent)
T=0.5s:   tool_finished (all 3 tools in parallel)
T=0.7s:   browser_frame (mutations only, ~2 captures)
T=1.0s:   tools_restored (Round 2 - tools from cache)
T=1.5s:   tool_finished (all 3 tools in parallel)
T=1.7s:   browser_frame (mutations only)
T=2.0s:   tools_restored (Round 3)
...
T=11.5s:  tools_restored (Round 12)
T=12.0s:  Conversation complete

Final logs:
  [cloud_runner] proxy_tool_loop_done
    inference_rounds=12
    tools_executed=[browser_navigate, browser_click, ...]
    duration_ms=12000
    schema_tokens_per_round=2750
    schema_tokens_saved=30250  ← 90% savings!
```

**Verify All Metrics:**

```bash
# Extract and validate metrics
grep "proxy_tool_loop_done" cloud_runner.log | tail -1

Validate:
  ✅ duration_ms < 15000  (should be 12-14s not 25-30s)
  ✅ schema_tokens_saved > 10000  (should save lots)
  ✅ tools_executed has expected tools
  ✅ inference_rounds = 12 (max reached)
```

---

## Regression Tests

### Make Sure Nothing Broke

**Test 1: Single Tool Call**
```bash
Prompt: "Just navigate to google.com"

Expected:
  ✅ Tool executes successfully
  ✅ Frame captured (mutation)
  ✅ Result properly truncated
  ✅ No errors in logs
```

**Test 2: Tool Filtering by Skill**
```bash
Request with skills=["browser_navigate"]

Expected:
  ✅ Only browser_navigate offered to model
  ✅ Other tools not in tools list
  ✅ Conversation works with skill filtering
```

**Test 3: Error Handling**
```bash
Prompt: "Use a tool that doesn't exist"

Expected:
  ✅ Model gets error message
  ✅ Continues with valid tools
  ✅ No crash or hang
```

**Test 4: Large Page Content**
```bash
Prompt: "Navigate to Wikipedia, extract all text"

Expected:
  ✅ Result truncated intelligently (not hard limit)
  ✅ Truncation message visible
  ✅ Message includes original size
```

**Test 5: Legacy Tools (6 original tools)**
```bash
Request that uses browser_navigate, browser_click, etc. (not agent-browser)

Expected:
  ✅ All legacy tools still work
  ✅ Backward compatible
  ✅ Same behavior as before
```

---

## Performance Benchmarks

### Before and After

**Setup one conversation and measure:**

```bash
# Latency
time curl -X POST ... agent message
  BEFORE: ~25-30s
  AFTER:  ~12-15s  (60% improvement)

# Token usage (from OpenRouter API response)
  BEFORE: ~108K input tokens (tools × 12 rounds)
  AFTER:  ~9K input tokens (tools × 1 round) (92% reduction)

# Storage (frame captures in database)
  BEFORE: 36 frames × 2-5MB = 72-180MB
  AFTER:  9-12 frames × 2-5MB = 18-60MB (70% reduction)

# API calls to OpenRouter
  BEFORE: 12 calls with full tools
  AFTER:  12 calls but only round 1 has 9KB tool overhead
```

---

## Success Criteria

✅ All tests below must pass to declare optimizations successful:

- [ ] Parallel execution: 3 tools in <700ms (was >1500ms)
- [ ] Frame capture: Only 9-12 captures for 12 rounds (was 36)
- [ ] Schema caching: Logs show 11 cache hits per 12 rounds
- [ ] Pre-bound executors: No ToolRegistry.get() during execution
- [ ] Smart truncation: Tree nodes preserved, text at boundaries
- [ ] No regressions: All tools work, error handling intact
- [ ] Full conversation: 12 rounds complete in <15s

---

## How to Run All Tests

```bash
# 1. Unit tests (for backend cache)
cd backend && npm test -- toolCache.test.ts

# 2. Integration tests
npm test -- createInferenceProxyRouter.test.ts

# 3. End-to-end test (manual)
# Follow the "Full 12-Round Conversation" test above

# 4. Performance benchmarks
npm run benchmark -- cloud-runtime

# 5. Regression tests
npm test -- regression.test.ts
```

---

## Monitoring Checklist

After deployment, monitor these in production:

```
Dashboard Metrics:
  ✅ Average conversation latency (should be 12-15s, was 25-30s)
  ✅ Token usage per conversation (should be 9K tools, was 108K)
  ✅ Tool schema tokens (should be 92% lower)
  ✅ Database storage for frames (should be 70% lower)
  ✅ Tool execution success rate (should be 99%+)
  ✅ Cache hit rate (should be 85%+)

Error Tracking:
  ⚠️ tools_cache_miss events (should be <1%)
  ⚠️ Tool execution errors (should be <0.1%)
  ⚠️ API errors from OpenRouter (should be unchanged)
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Parallel execution not working | `asyncio.gather()` not imported | Check cloud_runner.py imports |
| Frame captures for read-only tools | `browser_frame_tools()` not updated | Verify no_capture set has all read-only tools |
| Cache misses on every round | Backend toolCache not imported | Verify toolCache.ts exists and imported |
| Slower than before | Parallel execution failing | Check for errors in tool execution |
| Truncation broken | smart_truncate_tool_result not called | Verify it's called in cloud_runner.py |

Done! Now test and report results. 🚀
