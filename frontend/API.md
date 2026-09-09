# Mile — API endpoints expected by the native Wails frontend

Everything the frontend (`native_wails/mile/frontend/src/lib/api.ts`) calls
today. All calls are HTTP JSON to `API_BASE` = `VITE_API_URL ?? '/api/v1'`
(trailing slashes stripped).

Headers on every request: `Content-Type: application/json`, plus
`Authorization: Bearer <token>` whenever a token is passed.

- On **HTTP 401**: the stored token is cleared and a global `auth-expired`
  event fires (app logs out).
- On any non-2xx: the client reads `body.error` (fallback
  `Request failed (<status>)`) and throws it.

---

## Endpoints

### 1. POST `/register` · 2. POST `/login`
Auth: none

`register` body: `{ email, username, password }` · `login` body: `{ email, password }`

Expected response — `AuthResponse`:
```ts
interface AuthUser { id: string; email: string; username: string }
interface AuthResponse { token: string; user: AuthUser }
```

---

### 3. GET `/feed?count=N`
Auth: bearer token. Query: `count` = number of reel **groups** to fetch (client
sends 10).

A feed group (one `FeedItem`) is a node's full content bundle: one info card
(markdown) plus the flash cards and MCQ question cards generated from it. Any
of the card arrays may be empty. The client renders each group as a sequence
of pages: info → flash cards → question cards.

```json
[
  {
    "node_id": "…",
    "topic": "Channels in Go",
    "path": "0001.0003",
    "content": "# Channels…\n\nmarkdown",
    "flash_cards": [
      { "id": "…", "front": "What sends a value on a channel?", "back": "ch <- v" }
    ],
    "question_cards": [
      {
        "id": "…",
        "question": "How do you send x on channel ch?",
        "options": ["put(x, ch)", "x = ch", "ch <- x", "<- x ch"],
        "correct": "ch <- x"
      }
    ]
  }
]
```

`options` is a short shuffled set (correct answer + up to 3 random
distractors); `correct` is included so the client can grade instantly and
offline. Card `id`s are the persisted card row ids used by the response
endpoint.

---

### 4. POST `/stream` — create stream
Auth: bearer token

Creates a learning stream directly and seeds its roadmap. The clarifying-
questionnaire flow is a **placeholder** — not sent by the client today.

Request:
```json
{
  "topic": "Go concurrency",
  "instructions": "Focus on practical examples; assume I know basic Go"
}
```
`topic` required (max 255 chars); `instructions` optional free-form text (max
2000 chars) that is appended to the seeding/generation prompts.

Expected response (client doesn't inspect it today):
```ts
{ stream: unknown; nodes: unknown[] }
```

The created `stream` includes the `instructions` field.

---

### 5. GET `/streams` · 6. GET `/stream/{stream_id}/tree` · 7. DELETE `/stream/{stream_id}`

Auth: bearer token

```ts
interface StreamItem { id: string; user_id: string; topic: string; feedback: string; created_at: string }
interface TreeNode {
  node_id: string; topic: string; path: string
  is_leaf: boolean; generated: boolean
  status: 'watched' | 'skipped' | 'unwatched' | null
}
```
`deleteStream` expects `{ deleted: boolean }`.

---

### 8. POST `/article/{node_id}/status`
Auth: bearer token

Body: `{ "status": "watched" | "skipped" }` — marks the node's base card status
(drives feed availability + progress tree). Response: `{ "status": string }`.

---

### 9. POST `/card/response`
Auth: bearer token

Records one user attempt on a flash or question card. Each card is answered
**once per viewing**; the backend appends a single character to the card's
`responses` history (`'1'` = correct/knew it, `'0'` = wrong/missed),
oldest first — e.g. `"0011"` = two misses then two hits.

Request:
```json
{
  "card_type": "flash" | "question",
  "card_id": "…",          // id from the feed payload
  "correct": true
}
```

Response: `200` `{ "recorded": true }` · `404` `{ "error": "card not found" }`
(unknown id or not owned by the user) · `400` invalid body / `card_type`.

---

### 10. GET `/stream/{stream_id}/chat`
Auth: bearer token

Returns a stream's full chat history (oldest first):
```json
[
  {
    "id": "…",
    "role": "user" | "assistant",
    "content": "…",
    "card_type": "" | "info" | "flash" | "question",
    "card_id": "00000000-0000-0000-0000-000000000000",
    "created_at": "…"
  }
]
```
Empty (`[]`) until the first question is asked.

### 11. POST `/stream/{stream_id}/chat`
Auth: bearer token

Appends the learner's question, generates a grounded answer (card content +
last 8 messages as context), appends the reply, and returns the updated
history. `card_type`/`card_id` are optional soft references (no FK).

Request:
```json
{
  "question": "Why does buffering help here?",
  "card_type": "flash",
  "card_id": "…"
}
```
Errors: `400` missing/invalid fields, `404` stream or card not found,
`500` LLM/DB failure.

---

## Shared types

```ts
export interface FlashCard {
  id: string
  front: string
  back: string
}

export interface QuestionCard {
  id: string
  question: string
  options: string[]
  correct: string
}

export interface FeedItem {
  stream_id: string
  node_id: string
  topic: string
  path: string
  content: string
  info_card_id: string
  flash_cards: FlashCard[]
  question_cards: QuestionCard[]
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  card_type: '' | 'info' | 'flash' | 'question'
  card_id: string
  created_at: string
}
```

## Where each endpoint is used

| Endpoint | Call site |
|---|---|
| `register` / `login` | `AuthPage.tsx` → `api.register()` / `api.login()` |
| `feed` | `FeedPage.tsx` → `api.feed(10, token)` |
| `stream` (POST) | `CreateStreamModal.tsx` → `api.createStream(topic, instructions, token)` |
| `streams` | `StreamsMenu.tsx` → `api.listStreams(token)` |
| `stream/{id}/tree` | `ProgressView.tsx` → `api.streamTree(stream.id, token)` |
| `stream/{id}` (DELETE) | `StreamsMenu.tsx` → `api.deleteStream(stream.id, token)` |
| `article/{node_id}/status` | `FeedPage.tsx` → `api.setStatus(nodeId, status, token)` (group verdict) |
| `card/response` | `FeedPage.tsx` → `api.recordCardResponse(cardType, cardId, correct, token)` (per answered flash/question card) |
| `stream/{id}/chat` (GET/POST) | `QATab.tsx` → `api.getChat()` / `api.askChat()` |

Notes tab is still a placeholder.

## Frontend behaviour notes

- **Group verdict**: a group is reported *watched* only when **every flash card
  and every question card in it has been answered (right or wrong)**. Groups
  with no supplementary cards keep the old rule (10 s on the info page, or
  skipped when moving past). Leaving an incomplete group reports nothing, so it
  stays and is where you resume.
- **Resume**: answered cards persist locally (`mile.cardAnswers.v1`); on reload
  the feed opens at the first group with unanswered cards, and previously
  answered cards are shown answered/locked.
- **Chat scope**: the Chat tab follows the stream of the card last viewed in
  the feed (with a manual stream dropdown). When its card is still in view,
  new questions are tagged to that card and grounded on its content.
- **Flash cards**: double-tap to flip; after flipping the user self-grades
  (knew it / missed it). One answer per card — the card locks afterwards.
- **Question cards**: tapping an option grades instantly against `correct`
  (highlighting right/wrong) and locks the card.
- **Offline**: node verdicts and card responses are queued in localStorage
  (`mile.pendingStatus.v1`, `mile.pendingCardResponse.v1`) and replayed on the
  next successful feed refill.
