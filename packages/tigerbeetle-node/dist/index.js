"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createClient = exports.Operation = exports.CommitTransferError = exports.CommitFlags = exports.CreateTransferError = exports.TransferFlags = exports.CreateAccountError = exports.AccountFlags = void 0;
const binding = require('./client.node');
var AccountFlags;
(function (AccountFlags) {
    AccountFlags[AccountFlags["linked"] = 1] = "linked";
    AccountFlags[AccountFlags["debits_must_not_exceed_credits"] = 2] = "debits_must_not_exceed_credits";
    AccountFlags[AccountFlags["credits_must_not_exceed_debits"] = 4] = "credits_must_not_exceed_debits";
})(AccountFlags = exports.AccountFlags || (exports.AccountFlags = {}));
var CreateAccountError;
(function (CreateAccountError) {
    CreateAccountError[CreateAccountError["linked_event_failed"] = 1] = "linked_event_failed";
    CreateAccountError[CreateAccountError["exists"] = 2] = "exists";
    CreateAccountError[CreateAccountError["exists_with_different_user_data"] = 3] = "exists_with_different_user_data";
    CreateAccountError[CreateAccountError["exists_with_different_reserved_field"] = 4] = "exists_with_different_reserved_field";
    CreateAccountError[CreateAccountError["exists_with_different_unit"] = 5] = "exists_with_different_unit";
    CreateAccountError[CreateAccountError["exists_with_different_code"] = 6] = "exists_with_different_code";
    CreateAccountError[CreateAccountError["exists_with_different_flags"] = 7] = "exists_with_different_flags";
    CreateAccountError[CreateAccountError["exceeds_credits"] = 8] = "exceeds_credits";
    CreateAccountError[CreateAccountError["exceeds_debits"] = 9] = "exceeds_debits";
    CreateAccountError[CreateAccountError["reserved_field"] = 10] = "reserved_field";
    CreateAccountError[CreateAccountError["reserved_flag_padding"] = 11] = "reserved_flag_padding";
})(CreateAccountError = exports.CreateAccountError || (exports.CreateAccountError = {}));
var TransferFlags;
(function (TransferFlags) {
    TransferFlags[TransferFlags["linked"] = 1] = "linked";
    TransferFlags[TransferFlags["two_phase_commit"] = 2] = "two_phase_commit";
    TransferFlags[TransferFlags["condition"] = 4] = "condition";
})(TransferFlags = exports.TransferFlags || (exports.TransferFlags = {}));
var CreateTransferError;
(function (CreateTransferError) {
    CreateTransferError[CreateTransferError["linked_event_failed"] = 1] = "linked_event_failed";
    CreateTransferError[CreateTransferError["exists"] = 2] = "exists";
    CreateTransferError[CreateTransferError["exists_with_different_debit_account_id"] = 3] = "exists_with_different_debit_account_id";
    CreateTransferError[CreateTransferError["exists_with_different_credit_account_id"] = 4] = "exists_with_different_credit_account_id";
    CreateTransferError[CreateTransferError["exists_with_different_user_data"] = 5] = "exists_with_different_user_data";
    CreateTransferError[CreateTransferError["exists_with_different_reserved_field"] = 6] = "exists_with_different_reserved_field";
    CreateTransferError[CreateTransferError["exists_with_different_code"] = 7] = "exists_with_different_code";
    CreateTransferError[CreateTransferError["exists_with_different_amount"] = 8] = "exists_with_different_amount";
    CreateTransferError[CreateTransferError["exists_with_different_timeout"] = 9] = "exists_with_different_timeout";
    CreateTransferError[CreateTransferError["exists_with_different_flags"] = 10] = "exists_with_different_flags";
    CreateTransferError[CreateTransferError["exists_and_already_committed_and_accepted"] = 11] = "exists_and_already_committed_and_accepted";
    CreateTransferError[CreateTransferError["exists_and_already_committed_and_rejected"] = 12] = "exists_and_already_committed_and_rejected";
    CreateTransferError[CreateTransferError["reserved_field"] = 13] = "reserved_field";
    CreateTransferError[CreateTransferError["reserved_flag_padding"] = 14] = "reserved_flag_padding";
    CreateTransferError[CreateTransferError["debit_account_not_found"] = 15] = "debit_account_not_found";
    CreateTransferError[CreateTransferError["credit_account_not_found"] = 16] = "credit_account_not_found";
    CreateTransferError[CreateTransferError["accounts_are_the_same"] = 17] = "accounts_are_the_same";
    CreateTransferError[CreateTransferError["accounts_have_different_units"] = 18] = "accounts_have_different_units";
    CreateTransferError[CreateTransferError["amount_is_zero"] = 19] = "amount_is_zero";
    CreateTransferError[CreateTransferError["exceeds_credits"] = 20] = "exceeds_credits";
    CreateTransferError[CreateTransferError["exceeds_debits"] = 21] = "exceeds_debits";
    CreateTransferError[CreateTransferError["two_phase_commit_must_timeout"] = 22] = "two_phase_commit_must_timeout";
    CreateTransferError[CreateTransferError["timeout_reserved_for_two_phase_commit"] = 23] = "timeout_reserved_for_two_phase_commit";
})(CreateTransferError = exports.CreateTransferError || (exports.CreateTransferError = {}));
var CommitFlags;
(function (CommitFlags) {
    CommitFlags[CommitFlags["linked"] = 1] = "linked";
    CommitFlags[CommitFlags["reject"] = 2] = "reject";
    CommitFlags[CommitFlags["preimage"] = 4] = "preimage";
})(CommitFlags = exports.CommitFlags || (exports.CommitFlags = {}));
var CommitTransferError;
(function (CommitTransferError) {
    CommitTransferError[CommitTransferError["linked_event_failed"] = 1] = "linked_event_failed";
    CommitTransferError[CommitTransferError["reserved_field"] = 2] = "reserved_field";
    CommitTransferError[CommitTransferError["reserved_flag_padding"] = 3] = "reserved_flag_padding";
    CommitTransferError[CommitTransferError["transfer_not_found"] = 4] = "transfer_not_found";
    CommitTransferError[CommitTransferError["transfer_not_two_phase_commit"] = 5] = "transfer_not_two_phase_commit";
    CommitTransferError[CommitTransferError["transfer_expired"] = 6] = "transfer_expired";
    CommitTransferError[CommitTransferError["already_committed"] = 7] = "already_committed";
    CommitTransferError[CommitTransferError["already_committed_but_accepted"] = 8] = "already_committed_but_accepted";
    CommitTransferError[CommitTransferError["already_committed_but_rejected"] = 9] = "already_committed_but_rejected";
    CommitTransferError[CommitTransferError["debit_account_not_found"] = 10] = "debit_account_not_found";
    CommitTransferError[CommitTransferError["credit_account_not_found"] = 11] = "credit_account_not_found";
    CommitTransferError[CommitTransferError["debit_amount_was_not_reserved"] = 12] = "debit_amount_was_not_reserved";
    CommitTransferError[CommitTransferError["credit_amount_was_not_reserved"] = 13] = "credit_amount_was_not_reserved";
    CommitTransferError[CommitTransferError["exceeds_credits"] = 14] = "exceeds_credits";
    CommitTransferError[CommitTransferError["exceeds_debits"] = 15] = "exceeds_debits";
    CommitTransferError[CommitTransferError["condition_requires_preimage"] = 16] = "condition_requires_preimage";
    CommitTransferError[CommitTransferError["preimage_requires_condition"] = 17] = "preimage_requires_condition";
    CommitTransferError[CommitTransferError["preimage_invalid"] = 18] = "preimage_invalid";
})(CommitTransferError = exports.CommitTransferError || (exports.CommitTransferError = {}));
var Operation;
(function (Operation) {
    Operation[Operation["CREATE_ACCOUNT"] = 3] = "CREATE_ACCOUNT";
    Operation[Operation["CREATE_TRANSFER"] = 4] = "CREATE_TRANSFER";
    Operation[Operation["COMMIT_TRANSFER"] = 5] = "COMMIT_TRANSFER";
    Operation[Operation["ACCOUNT_LOOKUP"] = 6] = "ACCOUNT_LOOKUP";
    Operation[Operation["TRANSFER_LOOKUP"] = 7] = "TRANSFER_LOOKUP";
})(Operation = exports.Operation || (exports.Operation = {}));
let _args = undefined;
const isSameArgs = (args) => {
    if (typeof _args === 'undefined') {
        return false;
    }
    if (_args.replica_addresses.length !== args.replica_addresses.length) {
        return false;
    }
    let isSameReplicas = true;
    args.replica_addresses.forEach((entry, index) => {
        if (_args?.replica_addresses[index] !== entry) {
            isSameReplicas = false;
        }
    });
    return args.cluster_id === _args.cluster_id &&
        isSameReplicas;
};
let _client = undefined;
let _interval = undefined;
let _pinged = false;
function createClient(args) {
    const duplicateArgs = isSameArgs(args);
    if (!duplicateArgs && typeof _client !== 'undefined') {
        throw new Error('Client has already been initialized with different arguments.');
    }
    if (duplicateArgs && typeof _client !== 'undefined') {
        throw new Error('Client has already been initialized with the same arguments.');
    }
    _args = Object.assign({}, { ...args });
    const context = binding.init({
        ...args,
        replica_addresses: Buffer.from(args.replica_addresses.join(','))
    });
    const request = (operation, batch, callback) => {
        binding.request(context, operation, batch, callback);
    };
    const rawRequest = (operation, rawBatch, callback) => {
        binding.raw_request(context, operation, rawBatch, callback);
    };
    const createAccounts = async (batch) => {
        if (!_pinged) {
            await new Promise(resolve => {
                setTimeout(() => {
                    _pinged = true;
                    resolve();
                }, 600);
            });
        }
        return new Promise((resolve, reject) => {
            const callback = (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            };
            try {
                binding.request(context, Operation.CREATE_ACCOUNT, batch, callback);
            }
            catch (error) {
                reject(error);
            }
        });
    };
    const createTransfers = async (batch) => {
        if (!_pinged) {
            await new Promise(resolve => {
                setTimeout(() => {
                    _pinged = true;
                    resolve();
                }, 600);
            });
        }
        return new Promise((resolve, reject) => {
            const callback = (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            };
            try {
                binding.request(context, Operation.CREATE_TRANSFER, batch, callback);
            }
            catch (error) {
                reject(error);
            }
        });
    };
    const commitTransfers = async (batch) => {
        if (!_pinged) {
            await new Promise(resolve => {
                setTimeout(() => {
                    _pinged = true;
                    resolve();
                }, 600);
            });
        }
        return new Promise((resolve, reject) => {
            const callback = (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            };
            try {
                binding.request(context, Operation.COMMIT_TRANSFER, batch, callback);
            }
            catch (error) {
                reject(error);
            }
        });
    };
    const lookupAccounts = async (batch) => {
        return new Promise((resolve, reject) => {
            const callback = (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            };
            try {
                binding.request(context, Operation.ACCOUNT_LOOKUP, batch, callback);
            }
            catch (error) {
                reject(error);
            }
        });
    };
    const lookupTransfers = async (batch) => {
        return new Promise((resolve, reject) => {
            const callback = (error, results) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(results);
            };
            try {
                binding.request(context, Operation.TRANSFER_LOOKUP, batch, callback);
            }
            catch (error) {
                reject(error);
            }
        });
    };
    const destroy = () => {
        binding.deinit(context);
        if (_interval) {
            clearInterval(_interval);
        }
        _client = undefined;
    };
    _client = {
        createAccounts,
        createTransfers,
        commitTransfers,
        lookupAccounts,
        lookupTransfers,
        request,
        rawRequest,
        destroy
    };
    _interval = setInterval(() => {
        binding.tick(context);
    }, binding.tick_ms);
    return _client;
}
exports.createClient = createClient;
//# sourceMappingURL=index.js.map