/// <reference types="node" />
export interface InitArgs {
    cluster_id: bigint;
    replica_addresses: Array<string | number>;
}
export declare type Context = object;
export declare type Account = {
    id: bigint;
    user_data: bigint;
    reserved: Buffer;
    unit: number;
    code: number;
    flags: number;
    debits_reserved: bigint;
    debits_accepted: bigint;
    credits_reserved: bigint;
    credits_accepted: bigint;
    timestamp: bigint;
};
export declare enum AccountFlags {
    linked = 1,
    debits_must_not_exceed_credits = 2,
    credits_must_not_exceed_debits = 4
}
export declare enum CreateAccountError {
    linked_event_failed = 1,
    exists = 2,
    exists_with_different_user_data = 3,
    exists_with_different_reserved_field = 4,
    exists_with_different_unit = 5,
    exists_with_different_code = 6,
    exists_with_different_flags = 7,
    exceeds_credits = 8,
    exceeds_debits = 9,
    reserved_field = 10,
    reserved_flag_padding = 11
}
export declare type CreateAccountsError = {
    index: number;
    code: CreateAccountError;
};
export declare type Transfer = {
    id: bigint;
    debit_account_id: bigint;
    credit_account_id: bigint;
    user_data: bigint;
    reserved: Buffer;
    timeout: bigint;
    code: number;
    flags: number;
    amount: bigint;
    timestamp: bigint;
};
export declare enum TransferFlags {
    linked = 1,
    two_phase_commit = 2,
    condition = 4
}
export declare enum CreateTransferError {
    linked_event_failed = 1,
    exists = 2,
    exists_with_different_debit_account_id = 3,
    exists_with_different_credit_account_id = 4,
    exists_with_different_user_data = 5,
    exists_with_different_reserved_field = 6,
    exists_with_different_code = 7,
    exists_with_different_amount = 8,
    exists_with_different_timeout = 9,
    exists_with_different_flags = 10,
    exists_and_already_committed_and_accepted = 11,
    exists_and_already_committed_and_rejected = 12,
    reserved_field = 13,
    reserved_flag_padding = 14,
    debit_account_not_found = 15,
    credit_account_not_found = 16,
    accounts_are_the_same = 17,
    accounts_have_different_units = 18,
    amount_is_zero = 19,
    exceeds_credits = 20,
    exceeds_debits = 21,
    two_phase_commit_must_timeout = 22,
    timeout_reserved_for_two_phase_commit = 23
}
export declare type CreateTransfersError = {
    index: number;
    code: CreateTransferError;
};
export declare type Commit = {
    id: bigint;
    reserved: Buffer;
    code: number;
    flags: number;
    timestamp: bigint;
};
export declare enum CommitFlags {
    linked = 1,
    reject = 2,
    preimage = 4
}
export declare enum CommitTransferError {
    linked_event_failed = 1,
    reserved_field = 2,
    reserved_flag_padding = 3,
    transfer_not_found = 4,
    transfer_not_two_phase_commit = 5,
    transfer_expired = 6,
    already_auto_committed = 7,
    already_committed = 8,
    already_committed_but_accepted = 9,
    already_committed_but_rejected = 10,
    debit_account_not_found = 11,
    credit_account_not_found = 12,
    debit_amount_was_not_reserved = 13,
    credit_amount_was_not_reserved = 14,
    exceeds_credits = 15,
    exceeds_debits = 16,
    condition_requires_preimage = 17,
    preimage_requires_condition = 18,
    preimage_invalid = 19
}
export declare type CommitTransfersError = {
    index: number;
    code: CommitTransferError;
};
export declare type AccountID = bigint;
export declare type Event = Account | Transfer | Commit | AccountID;
export declare type Result = CreateAccountsError | CreateTransfersError | CommitTransfersError | Account;
export declare type ResultCallback = (error: undefined | Error, results: Result[]) => void;
export declare enum Operation {
    CREATE_ACCOUNT = 2,
    CREATE_TRANSFER = 3,
    COMMIT_TRANSFER = 4,
    ACCOUNT_LOOKUP = 5
}
export interface Client {
    createAccounts: (batch: Account[]) => Promise<CreateAccountsError[]>;
    createTransfers: (batch: Transfer[]) => Promise<CreateTransfersError[]>;
    commitTransfers: (batch: Commit[]) => Promise<CommitTransfersError[]>;
    lookupAccounts: (batch: AccountID[]) => Promise<Account[]>;
    request: (operation: Operation, batch: Event[], callback: ResultCallback) => void;
    rawRequest: (operation: Operation, rawBatch: Buffer, callback: ResultCallback) => void;
    destroy: () => void;
}
export declare function createClient(args: InitArgs): Client;
