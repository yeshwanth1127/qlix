# Quick Action Checklist: Test & Verify Everything

## Pre-Test Setup (5 min)

- [ ] Backend running: `npm run dev` (port 3000)
- [ ] Cloud runner ready: Python environment setup
- [ ] Test agent available (or create test agent ID)
- [ ] Logs accessible: `tail -f logs/cloud_runner.log` (new terminal)
- [ ] OpenRouter API key valid

---

## Test 1: Smoke Test (5 min)

**Goal:** Verify nothing is broken

```bash
# 1. Check backend is serving
curl http://localhost:3000/health
Expected: 200 OK

# 2. Create test conversation
curl -X POST http://localhost:3000/api/v1/agents/TEST/conversations \
  -H "Authorization: Bearer $(get_token)"
Expected: 201, get conversationId

# 3. Send simple message
curl -X POST http://localhost:3000/api/v1/agents/TEST/conversations/CONV_ID/messages \
  -H "Authorization: Bearer $(get_token)" \
  -d '{"content": "Navigate to google.com and take a screenshot", "skills": ["browser_navigate", "browser_screenshot"]}'
Expected: 201, conversation runs and completes in <3 seconds

# Result: ✅ PASS or ❌ FAIL
```

---

## Test 2: Parallel Execution (10 min)

**Goal:** Verify 3 tools complete in <700ms (not 1,500ms)

```bash
# Request 3 tools that each take ~500ms
curl -X POST ... agent message
Message: "Navigate to complex page, read structure, extract text"
Skills: ["browser_navigate", "browser_axtree", "browser_extract"]

# Monitor latency
Watch logs for:
  tool_finished tool=browser_navigate     <- Should be within 100-200ms
  tool_finished tool=browser_axtree       <- of each other (PARALLEL)
  tool_finished tool=browser_extract

# Result: 
  ✅ PASS: All 3 "tool_finished" appear within 100-200ms
  ❌ FAIL: Times are 500ms apart (sequential execution)
```

---

## Test 3: Selective Frame Capture (10 min)

**Goal:** Verify frames captured only for mutations (70% reduction)

```bash
# Request both mutation and read-only tools
curl -X POST ... agent message
Message: "Navigate to google, read page structure, take screenshot, extract text"

# Count frame events
grep "browser_frame" cloud_runner.log | wc -l
Expected: 2 frames (navigate + screenshot)
NOT:      4 frames (all tools)

# Verify correct tools captured
grep "browser_frame" cloud_runner.log
Expected output:
  browser_frame tool=browser_navigate
  browser_frame tool=browser_screenshot
NOT:
  browser_frame tool=browser_axtree
  browser_frame tool=browser_extract

# Result:
  ✅ PASS: Only 2 frames (mutations only)
  ❌ FAIL: 4 frames (all tools captured)
```

---

## Test 4: Schema Caching - Backend (15 min)

**Goal:** Verify backend caches and restores tools

```bash
# Request 12-round conversation (hits max_rounds default)
curl -X POST ... agent message
Message: "Keep iterating on the webpage multiple times"

# Watch logs for cache activity
grep -E "tools_cached|tools_restored|tools_cache_miss" cloud_runner.log

Expected output:
  [inference] tools_cached agentId=abc hash=xyz123 count=30       (Round 1)
  [inference] tools_restored agentId=abc hash=xyz123 count=30     (Round 2)
  [inference] tools_restored agentId=abc hash=xyz123 count=30     (Round 3)
  [inference] tools_restored agentId=abc hash=xyz123 count=30     (Round 4)
  [inference] tools_restored agentId=abc hash=xyz123 count=30     (Round 5)
  ... (6-12 all show tools_restored)
  [inference] tools_cache_miss: 0 times  (should be 0)

Count cache hits:
  grep "tools_restored" cloud_runner.log | wc -l
  Expected: 11 (rounds 2-12)

# Result:
  ✅ PASS: 1 cache + 11 restores, 0 misses
  ❌ FAIL: tools_cached appears multiple times (not working)
  ❌ FAIL: Many cache_miss events (TTL expired?)
```

---

## Test 5: Schema Caching - Token Savings (5 min)

**Goal:** Verify ~90% token reduction

```bash
# From previous test logs, find final line:
grep "proxy_tool_loop_done" cloud_runner.log | tail -1

Expected output:
  schema_tokens_per_round=2750
  schema_tokens_saved=30250  (2750 × 11)

Calculate:
  tokens_saved / (tokens_per_round × 12) = savings %
  30250 / (2750 × 12) = 30250 / 33000 = 91.7% ✅

# Result:
  ✅ PASS: >85% token savings
  ❌ FAIL: <50% savings (caching not working)
```

---

## Test 6: Pre-bound Executors (5 min)

**Goal:** Verify no ToolRegistry lookups during execution

```bash
# Run any conversation with tools
curl -X POST ... agent message

# Check logs for executor binding
grep "Building executor map" cloud_runner.log
Expected: YES (exactly once at session start)

# Count executor binding lines
grep "Bound:" cloud_runner.log | wc -l
Expected: 30 (all tools bound once)

# Verify NO registry lookups during execution
grep "ToolRegistry.get" cloud_runner.log
Expected: NOT FOUND (no lookups during execution)

# Result:
  ✅ PASS: Executor map built once, 30 tools bound
  ❌ FAIL: No executor map or lookups still happening
```

---

## Test 7: Smart Truncation (10 min)

**Goal:** Verify intelligent per-tool truncation

```bash
# Create test with large outputs
# 1. Complex page → browser_axtree (large tree)
curl -X POST ... agent message
Message: "Go to complex website and read page structure"

# Check truncation for axtree
grep -A5 "tool_finished tool=browser_axtree" cloud_runner.log
Expected to see: "[AX tree truncated: XXXX nodes, showing 500]"
NOT: Generic truncation message

# 2. Text-heavy page → browser_extract
Message: "Go to Wikipedia and extract article text"

# Check truncation for extract
grep "tool_finished tool=browser_extract" cloud_runner.log
Expected to see: "[Content truncated from XXXXX chars]"
At paragraph boundary (not mid-sentence)

# Result:
  ✅ PASS: Smart truncation messages visible
  ❌ FAIL: Generic "[Output truncated]" messages (old behavior)
```

---

## Test 8: Full Integration (20 min)

**Goal:** All 5 optimizations working together

```bash
# Run comprehensive test
curl -X POST ... complex agent message
Message: "Navigate to example.com, read structure, click elements, extract results. Do this 3-4 times."

# Verify in logs:
# ✅ Parallel execution (tool_finished within 200ms of each other)
grep "tool_finished" cloud_runner.log | tail -10

# ✅ Selective frames (only mutations)
grep "browser_frame" cloud_runner.log | wc -l
# Should be ~3-4 not 12-15

# ✅ Schema caching (cache hits on rounds 2+)
grep "tools_restored" cloud_runner.log | wc -l
# Should be 3-4 (one less than total rounds)

# ✅ Pre-binding (no lookups)
grep "Bound:" cloud_runner.log | wc -l
# Should be ~30

# ✅ Smart truncation (per-tool messages)
grep "truncated" cloud_runner.log
# Should see tool-specific messages

# ✅ Total latency (should be <15s for 4 rounds)
grep "proxy_tool_loop_done" cloud_runner.log | tail -1
# Check duration_ms should be <15000

# Result:
  ✅ PASS: All 5 optimizations visible and working
  ❌ FAIL: Some optimizations not present
```

---

## Test 9: Regression Tests (10 min)

**Goal:** Make sure nothing broke

```bash
# Test 1: Legacy tools still work
curl -X POST ... agent message
Skills: ["browser_navigate", "browser_click", "browser_type"]
Expected: ✅ Works without errors

# Test 2: Error handling intact
curl -X POST ... agent message
Skills: ["unknown_tool"]
Expected: ✅ Graceful error, conversation continues

# Test 3: Large results still truncated correctly
Message: "Extract the entire Wikipedia page text"
Expected: ✅ Result is reasonable size, not huge

# Test 4: Tool filtering works
Skills: ["browser_navigate"]
Expected: ✅ Only navigate offered, other tools not available

# Test 5: Concurrent conversations don't interfere
Start 2 conversations simultaneously
Expected: ✅ Both complete successfully, separate cache entries

# Result:
  ✅ PASS: All regressions pass
  ❌ FAIL: Any regression failure
```

---

## Performance Verification (5 min)

**Goal:** Confirm 60-70% latency improvement

```bash
# Measure end-to-end latency
time curl -X POST ... agent message
Message: "Perform 3-4 sequential browser interactions"

Expected:
  ❌ BEFORE: 25-30 seconds
  ✅ AFTER:  12-15 seconds

# Calculate improvement:
  (25 - 12) / 25 = 52% improvement (acceptable)
  (30 - 12) / 30 = 60% improvement (good)

# Result:
  ✅ PASS: >50% latency reduction
  ❌ FAIL: <30% improvement (something wrong)
```

---

## Final Summary

### Overall Result

```
Test                          Status      Required  Issue?
─────────────────────────────────────────────────────────────
1. Smoke test                  ___         ✅        □
2. Parallel execution          ___         ✅        □
3. Selective frame capture     ___         ✅        □
4. Schema caching (backend)    ___         ✅        □
5. Token savings               ___         ✅        □
6. Pre-bound executors         ___         ✅        □
7. Smart truncation            ___         ✅        □
8. Full integration            ___         ✅        □
9. Regressions                 ___         ✅        □
10. Performance improvement    ___         ✅        □

Status Legend:
  ✅ = PASS (test succeeded as expected)
  ⚠️  = WARN (test passed but with minor issues)
  ❌ = FAIL (test did not meet expectations)
```

### If All Tests Pass ✅
```
Congratulations! All 5 optimizations are working correctly.
You can proceed to production deployment with confidence.

Improvements delivered:
  • 60-70% faster conversations (12-15s vs 25-30s)
  • 90% token savings on tool schemas
  • 70% fewer frame captures and storage
  • 3x parallel tool execution
  • Smart result truncation
```

### If Any Test Fails ❌
```
1. Check TESTING_GUIDE.md for detailed troubleshooting
2. Review logs for error messages
3. Verify all code changes were applied
4. Check backend/frontend are running latest code
5. If stuck, see TROUBLESHOOTING section in TESTING_GUIDE.md
```

---

## Quick Reference: What Each Log Line Means

```
✅ [cloud_runner] tools_cached
   → Backend successfully cached tools (round 1)

✅ [cloud_runner] tools_restored
   → Backend successfully restored tools from cache (round 2+)

❌ [cloud_runner] tools_cache_miss
   → Cache lookup failed, client should resend tools

✅ [cloud_runner] tool_finished
   → Tool execution completed

✅ [cloud_runner] browser_frame
   → Screenshot captured (only for mutations)

✅ [cloud_runner] schema_tokens_saved
   → Final tally of tokens saved

⚠️  [cloud_runner] (multiple tool_finished within 100ms)
   → Parallel execution confirmed
```

---

**Ready to test? Start with Test 1 above and work through the list!** 🚀
