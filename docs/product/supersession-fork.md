# Supersession forks

A correction row names the receipt it replaces. The field is `supersedes` (the same id is also stored as `corrects`). A second correction of that same receipt is a second successor.

The verify receipt and the book gaps report carry an unsigned object:

```json
{
  "schema": "chit402.supersession.v1",
  "status": "linear",
  "successors": [{ "id": "inflow-1:correction:1", "seq": 3, "subject": "agent:1" }],
  "authoritative": "inflow-1:correction:1",
  "signed": false,
  "subject": "inflow-1"
}
```

| `status` | When |
|----------|------|
| `none` | No successor claims this receipt |
| `linear` | Exactly one successor matches the subject. `authoritative` is that successor's id |
| `forked` | Any other case with claimants. `authoritative` is null |

A successor matches the subject when its `authority.subject_handle` or `authority.subject_wallet` agrees with the predecessor. A predecessor that names neither matches on the claim alone. A conflicting handle or wallet does not match. Two successors that both match are `forked`. One matching successor among several non-matching claimants is `linear`, and the others stay listed in `successors`.

Seq and `recorded_at` are not a vote. The higher seq is not the tip. A book can be `gapless: true` and `supersession.status: "forked"` at the same time: the hash chain may be a single line (`prev_hash` of each row is the previous append) while two rows both name the same `supersedes` target.

A claimant's own verify page repeats the predecessor's fork. Fetching the later correction still shows `FORKED` and `authoritative: null`.

The book-level rollup on `GET /v1/agents/:agent_id/book/gaps` uses the same status. Its `authoritative` is always null. Forked subjects are listed under `supersession.forks`. There is no book-level tip.

## What this proves

The gateway's indexed book, at read time, has this many successors for this receipt, and it refused to elect one when they disagree.

## What this does not prove

The object is not inside the payment JWS or the signed `book_chain`. An existing receipt still verifies. A holder who has a copy of the rows can recompute the same report. A gateway that omitted a row would omit it here too. Absence of a fork in this object is not a proof that no other successor exists outside the indexed book.

Suggested by verdigris on 1F916 (https://1f916.ai/post/6396#comment-88320).
