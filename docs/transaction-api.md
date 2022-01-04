# Transaction API

## Lifecycle

### Payment creation

A user creates a payment by passing a `PaymentIntent` to `Mutation.createOutgoingPayment`. If the payment destination (the payment pointer or invoice URL) is successfully resolved, the payment is created in the `Quoting` state.

If the payment destination cannot be resolved, no payment is created and the query returns an error.

### Quoting

To begin a payment attempt, an instance acquires a lock to setup and quote the payment, advancing it from `Quoting` to the `Funding` state.

First, the recipient Open Payments account or invoice is resolved. Then, the STREAM sender quotes the payment to probe the exchange rate, compute a minimum rate, and discover the path maximum packet amount.

Quotes can end in 3 states:

1. Success. The STREAM sender successfully established a connection to the recipient, and discovered rates and the path capacity. This advances the state to `Funding`. The parameters of the quote are persisted so they may be resumed if the payment is funded. Rafiki also assigns a deadline based on the expected validity of its slippage parameters for the wallet to fund the payment.
2. Irrevocable failure. In cases such as if the payment pointer or account URL was semantically invalid, the invoice was already paid, a terminal ILP Reject was encountered, or the rate was insufficient, the payment is unlikely to ever succeed, or requires some manual intervention. These cases advance the state to `Cancelled`.
3. Recoverable failure. In the case of some transient errors, such as if the Open Payments HTTP query failed, the quote couldn't complete within the timeout, or no external exchange rate was available, Rafiki may elect to automatically retry the quote. This returns the state to `Quoting`, but internally tracks that the quote failed and when to schedule another attempt.

After the quote ends and state advances, the lock on the payment is released.

### Authorization

After quoting completes, Rafiki notifies the wallet operator via an `outgoing_payment.funding` to add `maxSourceAmount` of the quote from the funding wallet account owned by the payer to the payment, reserving the maximum requisite funds for the payment attempt.

If the payment is to an invoice, a client should manually approve the payment, based on the parameters of the quote, before the wallet adds payment liquidity.

This step is necessary so the end user can precisely know the maximum amount of source units that will leave their account. Typically, the payment application will present these parameters in the user interface before the user elects to approve the payment. This step is particularly important for invoices, to prevent an unbounded sum from leaving the user's account. During this step, the user may also be presented with additional information about the payment, such as details of the payment recipient, or how much is expected to be delivered.

Authorization ends in two possible states:

1. Approval. If the user approves the payment before its funding deadline, or `amountToSend` was specified, the wallet funds the payment and the state advances to `Sending`.

2. Cancellation. If the user explicitly cancels the quote, or the funding deadline is exceeded, the state advances to `Cancelled`. In the latter case, too much time has elapsed for the enforced exchange rate to remain accurate.

### Payment execution

To send, an instance acquires a lock on a payment with a `Sending` state.

The instance sends the payment with STREAM, which uses the quote parameters acquired during the `Quoting` state.

After the payment completes, the instance releases the lock on the payment and advances the state depending upon the outcome:

1. Success. If the STREAM sender successfully fulfilled the completion criteria of the payment, sending or delivering the requisite amount, the payment is complete. The instance advances the state to `Completed`, the final state of the payment.
2. Irrevocable failure. In cases such as if the exchange rate changed (the payment cannot be completed within the parameters of the quote), the receiver closed the connection, or a terminal ILP Reject was encountered, the payment failed permanently. Manual intervention is required to quote and retry the payment, so the state advances to `Cancelled`.

   After too many recoverable failures and attempts, Rafiki may also consider a payment permanently failed, advancing the state to `Cancelled`.

3. Recoverable failure. In cases such as an idle timeout, Rafiki may elect to automatically retry the payment. The state remains `Sending`, but internally tracks that the payment failed and when to schedule another attempt.

In the `Completed` and `Cancelled` cases, the wallet is notifed of any remaining funds in the Interledger account via `outgoing_payment.completed` and `outgoing_payment.cancelled` webhook events. Note: if the payment is retried, the same Interledger account is used for the subsequent attempt.

### Manual recovery

A payment in the `Cancelled` state may be explicitly retried ("requoted") by the user. The retry will quote (and eventually attempt to send) the remainder of the payment:

- A `FixedSend` payment will attempt to pay `intent.amountToSend - amountAlreadySent`.
- A `FixedDelivery` payment will attempt to pay the remaining `invoice.amount - invoice.received` (according to the remote invoice state).

## Resources

### `PaymentIntent`

The intent must include `invoiceUrl` xor (`paymentPointer` and `amountToSend`).

| Name             | Optional | Type     | Description                                                                                           |
| :--------------- | :------- | :------- | :---------------------------------------------------------------------------------------------------- |
| `paymentPointer` | Yes      | `String` | Payment pointer or URL of the destination Open Payments or SPSP account. Requires `amountToSend`.     |
| `invoiceUrl`     | Yes      | `String` | URL of an Open Payments invoice, for a fixed-delivery payment.                                        |
| `amountToSend`   | Yes      | `String` | Fixed amount to send to the recipient, in base units of the sending asset. Requires `paymentPointer`. |

### `OutgoingPayment`

| Name                             | Optional | Type            | Description                                                                                                                                                                                                                                                                                                              |
| :------------------------------- | :------- | :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                             | No       | `ID`            | Unique ID for this account, randomly generated by Rafiki.                                                                                                                                                                                                                                                                |
| `state`                          | No       | `PaymentState`  | See [`PaymentState`](#paymentstate).                                                                                                                                                                                                                                                                                     |
| `error`                          | Yes      | `String`        | Failure reason.                                                                                                                                                                                                                                                                                                          |
| `stateAttempts`                  | No       | `Integer`       | Retry number at current state.                                                                                                                                                                                                                                                                                           |
| `intent`                         | No       | `PaymentIntent` | See [`PaymentIntent`](#paymentintent).                                                                                                                                                                                                                                                                                   |
| `quote`                          | Yes      | `Object`        | Parameters of payment execution and the projected outcome of a payment.                                                                                                                                                                                                                                                  |
| `quote.timestamp`                | No       | `String`        | Timestamp when the most recent quote for this transaction finished.                                                                                                                                                                                                                                                      |
| `quote.activationDeadline`       | No       | `String`        | Time when this quote expires.                                                                                                                                                                                                                                                                                            |
| `quote.targetType`               | No       | `PaymentType`   | See [`PaymentType`](#paymenttype).                                                                                                                                                                                                                                                                                       |
| `quote.minDeliveryAmount`        | No       | `UInt64`        | Minimum amount that will be delivered if the payment completes, in the base unit and asset of the receiving account. For fixed delivery payments, this will be the remaining amount of the invoice.                                                                                                                      |
| `quote.maxSourceAmount`          | No       | `UInt64`        | Maximum amount that will be sent in the base unit and asset of the sending account. This is intended to be presented to the user or agent before authorizing a fixed delivery payment. For fixed source amount payments, this will be the provided `amountToSend`.                                                       |
| `quote.maxPacketAmount`          | No       | `UInt64`        | Discovered maximum packet amount allowed over this payment path.                                                                                                                                                                                                                                                         |
| `quote.minExchangeRate`          | No       | `Float`         | Aggregate exchange rate the payment is guaranteed to meet, as a ratio of destination base units to source base units. Corresponds to the minimum exchange rate enforced on each packet (_except for the final packet_) to ensure sufficient money gets delivered. For strict bookkeeping, use `maxSourceAmount` instead. |
| `quote.lowExchangeRateEstimate`  | No       | `Float`         | Lower bound of probed exchange rate over the path (inclusive). Ratio of destination base units to source base units.                                                                                                                                                                                                     |
| `quote.highExchangeRateEstimate` | No       | `Float`         | Upper bound of probed exchange rate over the path (exclusive). Ratio of destination base units to source base units.                                                                                                                                                                                                     |
| `accountId`                      | No       | `String`        | Id of the payer's Open Payments account.                                                                                                                                                                                                                                                                                 |
| `destinationAccount`             | No       | `Object`        |                                                                                                                                                                                                                                                                                                                          |
| `destinationAccount.scale`       | No       | `Integer`       |                                                                                                                                                                                                                                                                                                                          |
| `destinationAccount.code`        | No       | `String`        |                                                                                                                                                                                                                                                                                                                          |
| `destinationAccount.url`         | No       | `String`        | URL of the recipient Open Payments/SPSP account (with well-known path, and stripped trailing slash). Each payment pointer and its corresponding account URL identifies a unique payment recipient.                                                                                                                       |
| `outcome`                        | No       | `Object`        | Only set once a payment reaches the sending state. Subsequent attempts add to the totals, and the outcome persists even if a payment attempt fails.                                                                                                                                                                      |
| `outcome.amountSent`             | No       | `UInt64`        | Total amount sent and fulfilled, across all payment attempts, in base units of the source asset.                                                                                                                                                                                                                         |
| `createdAt`                      | No       | `String`        |                                                                                                                                                                                                                                                                                                                          |

### `PaymentState`

- `QUOTING`: Initial state. In this state, an empty payment account is generated, and the payment is automatically resolved & quoted. On success, transition to `FUNDING` or `SENDING` if already funded. On failure, transition to `Cancelled`.
- `FUNDING`: Awaiting the wallet to add payment liquidity. The wallet gets user approval (for payments without `amountToSend`) before reserving money from the user's wallet account. On success, transition to `Sending`. Otherwise, transitions to `Cancelled` when the quote expires.
- `SENDING`: Stream payment from the payment account to the destination.
- `CANCELLED`: The payment failed. (Though some money may have been delivered). Requoting transitions to `Quoting`.
- `COMPLETED`: Successful completion.

### `PaymentType`

- `FIXED_SEND`: Fixed source amount.
- `FIXED_DELIVERY`: Invoice payment, fixed delivery amount.
