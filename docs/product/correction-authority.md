# Subject authority

A correction row and a successor row (one with `parent_ref`) carry `authority`. A plain spend row does not.

| Field | Meaning |
|-------|---------|
| `subject_handle` | Handle whose act the row records. A correction can name it in the request (`subject_handle`). Otherwise the book uses `agent:<id>`. |
| `subject_wallet` | Wallet whose act the row records, when one was given or the parent row had a payer |
| `writer` | `gateway`. The process that appended the row |
| `issuer` | `chit402`. The key that signed `book_chain` |

`authority` is inside the signed `book_chain` at payload version 3. The payment JWS is unchanged.

## What this proves

The issuer says this row records that subject's act, and names a writer and an issuer that are different fields. A holder can see that the subject is not labeled as the signer.

## What this does not prove

It does not prove the subject authorized the correction. It does not prove the handle controls the wallet. A missing handle falls back to `agent:<id>`, which names the book, not a separate person.
