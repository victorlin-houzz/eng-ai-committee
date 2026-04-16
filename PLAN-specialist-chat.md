# Per-Finding Specialist Chat with Resolution Annotations

## Context

After a review, users need to have a back-and-forth with the AI to understand specific findings and figure out how to address them. The Judge persona is wrong for this — it gives verdicts, not coaching. Instead, each finding should link back to the specialist agent that raised it (Security, Architecture, Product) so the user can ask "would X approach solve this?" and get a domain-expert answer. After the discussion concludes, the user should be able to annotate the finding with a resolution note that persists in the report.

Runs stay independent — no cross-run linking.

## What Already Exists (don't rebuild)

- `web/server/chat-handler.ts` — Judge chat (keep for verdict-level questions; repurpose pattern for specialist chat)
- `web/client/chat-panel.ts` — Streaming chat UI (reuse the pattern, not the class itself)
- `web/server/history-store.ts` — SQLite with `conversation_log` (extend for annotations)
- `web/server/socket-handler.ts` — Socket event registration (add new events here)
- Finding cards rendered in `web/client/main.ts` via `openFindingsModal()` (add buttons here)

## UX Flow

```
Verdict shown → Finding cards visible
  → User clicks [Ask Security ▼] on a finding card
  → Specialist drawer opens (scoped to that finding)
    → Finding context shown at top (title, excerpt, recommendation)
    → Multi-turn chat below:
        User: "Would adding an API gateway solve this?"
        Specialist: "Yes — specifically add rate limiting at the gateway level..."
        User: "What about login via OAuth providers, do they also need this?"
        Specialist: "Yes, OAuth callback endpoints should also be rate-limited..."
        [↳ Apply to editor] whenever specialist suggests text
        ... user can keep chatting until satisfied ...
    → When satisfied, user writes a resolution note and clicks [Save & annotate]
    → Finding card shows ✎ "Added rate limiting section per security rec"
    → Doc editor already has applied suggestions from the conversation
  → User re-runs fresh review if they want committee sign-off
```

Key: the conversation stays open indefinitely. Apply-to-editor can happen multiple times during the discussion. The resolution note is saved when the user is done — not forced at the end of a single exchange.

## Implementation Plan

### 1. DB — Finding annotations (`web/server/history-store.ts`)

Add `finding_annotations` table via `ALTER TABLE`-style migration block (same pattern as `access_token` migration, lines 87–91):

```sql
CREATE TABLE IF NOT EXISTS finding_annotations (
  run_id      TEXT NOT NULL,
  finding_id  TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, finding_id)
);
```

Add two functions:
- `saveAnnotation(runId: string, findingId: string, note: string): void`
- `getAnnotations(runId: string): Map<string, string>` — returns `findingId → note`

### 2. Server — Specialist chat handler (`web/server/chat-handler.ts`)

Add `buildSpecialistPrompt(finding: Finding, docText: string): string` alongside existing `buildSystemPrompt`.

Specialist personas keyed by `finding.agent`:
```ts
const SPECIALIST_PERSONA: Record<string, string> = {
  'security-compliance': 'Security & Compliance specialist',
  'architecture-infra':  'Architecture & Infrastructure specialist',
  'product-ops':         'Product & Operations specialist',
};
```

Prompt structure:
```
You are the {persona} from an engineering committee AI review.
You flagged the following issue:

FINDING: [{severity}] {title}
Excerpt: "{excerpt}"
Assessment: {description}
Recommendation: {recommendation}

DOCUMENT CONTEXT (40K char limit):
{docText truncated}

Help the author understand and resolve this specific concern.
Apply-to-editor suggestions: {"insert": "text", "section": "section name"}
```

Add `registerFindingChatHandler(socket, sessionResults)`:
- Listens for `finding:chat` event: `{ runId, findingId, message, history }`
- Looks up `sessionResults.get(runId)` for `{ result, docText }`
- Finds the finding by ID in `result.allFindings`
- Streams response as `finding:chat:token` / `finding:chat:done` / `finding:chat:error`
- Logs to `conversation_log` with kind `finding_chat_user` / `finding_chat_assistant`, payload includes `findingId`

### 3. Server — Wire up new events (`web/server/socket-handler.ts`)

In `setupSocketHandlers`:
- Call `registerFindingChatHandler(socket, sessionResults)` alongside existing `registerChatHandler()`
- Add `finding:annotate` handler: `{ runId, findingId, note }` → calls `saveAnnotation()`, emits `finding:annotated`
- Add `finding:annotations:get` handler: `{ runId }` → emits `finding:annotations:result` with the annotations map

### 4. Client — Specialist chat drawer (`web/client/finding-chat.ts`, new file)

Small class `FindingChat`:
```ts
class FindingChat {
  open(runId: string, finding: Finding): void  // renders drawer, sets context header
  close(): void
  onApplySuggestion?: (text: string, section: string) => void
  onAnnotate?: (findingId: string, note: string) => void
}
```

Drawer structure (injected into `<body>`):
```
┌─ [Security & Compliance] ─────────────── [×] ─┐
│ [HIGH] No rate limiting on auth endpoints       │
│ "Your /auth/login endpoint has no..."           │
│ Recommendation: Add rate limiting via API GW    │
├─────────────────────────────────────────────────┤
│ [chat messages area - scrollable, multi-turn]   │
│   Security: This was flagged because...         │
│   You: Would an API gateway solve this?         │
│   Security: Yes — add rate limiting at...       │
│             [↳ Apply to editor]                 │
│   You: What about OAuth callback endpoints?     │
│   Security: Those need it too. Suggest:...      │
│             [↳ Apply to editor]                 │
├─────────────────────────────────────────────────┤
│ [chat input]                        [Send →]    │
├ ─ ─ Finalize when done ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│ [Resolution note input]      [Save & annotate]  │
└─────────────────────────────────────────────────┘
```

- Multi-turn: `history` array accumulates like `ChatPanel` — user can send as many messages as needed
- `{"insert": ..., "section": ...}` in any response shows an Apply button inline (same as chat-panel.ts:91-103)
- Resolution note section is always visible at the bottom but non-blocking — user fills it in when done
- "Save & annotate" emits `finding:annotate` and updates the finding card; drawer stays open so user can keep chatting if needed

Add minimal CSS to `web/client/styles/chat.css` (drawer slide-in from right or bottom).

### 5. Client — Wire up finding cards (`web/client/main.ts`)

In `openFindingsModal()` (currently at line ~83), add to each `finding-card`:
- **"Ask [Specialist]" button** — displays the right specialist label based on `finding.agent`
- **Resolution note display** — if `annotationsMap.get(finding.id)` exists, show `✎ {note}` below the card

On `pipeline:complete`, fetch annotations for the `runId` via `finding:annotations:get` and store in a local `Map<string, string>`.

When "Ask [Specialist]" is clicked, call `findingChat.open(currentRunId, finding)`.

Wire `findingChat.onApplySuggestion` to the existing editor apply function.
Wire `findingChat.onAnnotate` to emit `finding:annotate` and update the local annotations map (re-render the finding card note).

### 6. Update `ConversationEntry` type (`web/server/history-store.ts`)

Extend the `kind` union type to include `'finding_chat_user' | 'finding_chat_assistant'` for the log.

## Files to Modify / Create

| File | Change |
|------|--------|
| `web/server/history-store.ts` | Add `finding_annotations` table, `saveAnnotation`, `getAnnotations` |
| `web/server/chat-handler.ts` | Add `buildSpecialistPrompt`, `registerFindingChatHandler` |
| `web/server/socket-handler.ts` | Register new handler + `finding:annotate` / `finding:annotations:get` events |
| `web/client/finding-chat.ts` | New file — specialist chat drawer class |
| `web/client/main.ts` | Add "Ask specialist" buttons to finding cards, wire drawer, show annotations |
| `web/client/styles/chat.css` | Add drawer styles |

No changes to: `src/pipeline/`, `orchestrator.ts`, `judge.ts`, or any agent logic.

## Verification

1. Complete a review that returns at least one finding
2. Click "Ask Security" (or appropriate specialist) on a finding card
3. Specialist drawer opens with finding context pre-loaded at top
4. Ask "Would adding an API gateway solve this?" — specialist should respond with domain knowledge
5. If specialist suggests text, click "Apply to editor" — confirm text appears in editor
6. Type a resolution note and click "Save note"
7. Close drawer — finding card should show the resolution note below it
8. Reload page, rejoin session — annotations should still be visible (persisted in DB)
