# Security Specification & Hardened Rules Audit (Phase 0)

## 1. Data Invariants
1. **PII Isolation**: `email` never appears in `users_public`. Only `users_private/{uid}` stores `email`, readable and writable exclusively by `request.auth.uid == uid`.
2. **Identity Ownership**: Every `create` document (`users_public`, `users_private`, `handles`, `reading_state`, `follows`, `blocks`, `reports`, `messages`) must bind its owner/author field (`uid`, `followerId`, `blockerId`, `reporterId`, `senderId`) strictly to `request.auth.uid`.
3. **Immutable Provenance**: `uid`, `createdAt`, `senderId`, `recipientId`, `threadKey`, `participantA`, `participantB` are immutable after document creation.
4. **Master Gate**: Messages under `/conversations/{threadKey}/messages/{messageId}` require reading the parent `/conversations/{threadKey}` document and confirming `request.auth.uid` is `participantA` or `participantB`.
5. **Atomic Follow Counts**: Updating another user's `followerCount` in `users_public/{targetId}` is only permitted alongside an atomic `existsAfter` / `!existsAfter` change on `/follows/{uid}__{targetId}` with exact +/-1 delta.
6. **Temporal Integrity**: `createdAt`, `updatedAt`, and `lastActiveAt` must equal `request.time`.
7. **Block Enforcement**: Creating a message fails if either participant has a block record against the other.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. **Unauthenticated Read/Write**: Read `users_public` or create `conversations/{t}` with `request.auth == null`.
2. **PII Cross-Read**: Authenticated User A reads `users_private/{userB}` to steal User B's email.
3. **Shadow Field Injection on Profile**: User A updates `users_public/{userA}` adding `{ "isAdmin": true }` or `{ "followerCount": 9999 }`.
4. **Follower Count Inflation Without Follow Edge**: User A updates `users_public/{userB}` setting `followerCount = 500` without creating `follows/{userA}__{userB}`.
5. **Spoofed Sender ID**: User A creates a message in `conversations/{t}/messages/{m}` with `senderId = userB`.
6. **Unjoined Thread Eavesdropping**: User C reads or lists `conversations/{A__B}` or `conversations/{A__B}/messages`.
7. **Blocked User Bypass**: User A creates a message to User B while `/blocks/{userB}__{userA}` exists.
8. **Cross-User Reaction Tampering**: Participant A updates `reactionB` on a message in `conversations/{A__B}/messages/{m}`.
9. **Other User's Message Edit/Delete**: Participant B edits or deletes a message sent by Participant A.
10. **Immutable Field Tampering**: User A updates `createdAt` or `participantA` on an existing conversation.
11. **Oversized String / Resource Poisoning**: Injecting a 500KB `text` field on a message (`> 4000` chars) or a 2KB document ID.
12. **Client Timestamp Forgery**: Creating `users_public/{uid}` with backdated `createdAt: Timestamp(2000-01-01)`.
