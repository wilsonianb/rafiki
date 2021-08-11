import { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type RequireFields<T, K extends keyof T> = { [X in Exclude<keyof T, K>]?: T[X] } & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
  UInt64: bigint;
};

export type Amount = {
  __typename?: 'Amount';
  amount: Scalars['UInt64'];
  currency: Scalars['String'];
  scale: Scalars['Int'];
};

export type Asset = {
  __typename?: 'Asset';
  code: Scalars['String'];
  scale: Scalars['Int'];
};

export type AssetInput = {
  code: Scalars['String'];
  scale: Scalars['Int'];
};

export type Balance = {
  __typename?: 'Balance';
  id: Scalars['ID'];
  createdTime: Scalars['String'];
  asset: Asset;
  balance: Scalars['UInt64'];
  netLiability?: Maybe<Scalars['UInt64']>;
  netAssets?: Maybe<Scalars['UInt64']>;
  creditExtended: Scalars['UInt64'];
  totalLent: Scalars['UInt64'];
  operator?: Maybe<Operator>;
};

export type CreateDepositInput = {
  /** The id of the account to create the deposit for. */
  ilpAccountId: Scalars['ID'];
  /** Amount of deposit. */
  amount: Scalars['String'];
  /** The id of the deposit. */
  id?: Maybe<Scalars['ID']>;
};

export type CreateDepositMutationResponse = MutationResponse & {
  __typename?: 'CreateDepositMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  deposit?: Maybe<Deposit>;
};

export type CreateIlpAccountInput = {
  id?: Maybe<Scalars['ID']>;
  disabled?: Maybe<Scalars['Boolean']>;
  superAccountId?: Maybe<Scalars['ID']>;
  maxPacketAmount?: Maybe<Scalars['String']>;
  http?: Maybe<HttpInput>;
  asset: AssetInput;
  stream?: Maybe<StreamInput>;
  routing?: Maybe<RoutingInput>;
};

export type CreateIlpAccountMutationResponse = MutationResponse & {
  __typename?: 'CreateIlpAccountMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  ilpAccount: IlpAccount;
};

export type CreateIlpSubAccountMutationResponse = MutationResponse & {
  __typename?: 'CreateIlpSubAccountMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  ilpAccount: IlpAccount;
};

export type CreateWebhookMutationResponse = MutationResponse & {
  __typename?: 'CreateWebhookMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  webhook: Webhook;
};

export type CreateWithdrawalMutationResponse = MutationResponse & {
  __typename?: 'CreateWithdrawalMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  withdrawal: Withdrawal;
};

export type DeleteIlpAccountMutationResponse = MutationResponse & {
  __typename?: 'DeleteIlpAccountMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type DeleteWebhookMutationResponse = MutationResponse & {
  __typename?: 'DeleteWebhookMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type Deposit = {
  __typename?: 'Deposit';
  id: Scalars['ID'];
  amount: Scalars['UInt64'];
  ilpAccountId: Scalars['ID'];
};

export type DepositEdge = {
  __typename?: 'DepositEdge';
  node: Deposit;
  cursor: Scalars['String'];
};

export type DepositsConnection = {
  __typename?: 'DepositsConnection';
  pageInfo: PageInfo;
  edges: Array<DepositEdge>;
};

export type ExtendCreditMutationResponse = MutationResponse & {
  __typename?: 'ExtendCreditMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type FinalizePendingWithdrawalMutationResponse = MutationResponse & {
  __typename?: 'FinalizePendingWithdrawalMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type Http = {
  __typename?: 'Http';
  incoming: HttpIncoming;
  outgoing: HttpOutgoing;
};

export type HttpIncoming = {
  __typename?: 'HttpIncoming';
  authTokens: Array<Scalars['String']>;
};

export type HttpIncomingInput = {
  authTokens: Array<Scalars['String']>;
};

export type HttpInput = {
  incoming: HttpIncomingInput;
  outgoing: HttpOutgoingInput;
};

export type HttpOutgoing = {
  __typename?: 'HttpOutgoing';
  authToken: Scalars['String'];
  endpoint: Scalars['String'];
};

export type HttpOutgoingInput = {
  authToken: Scalars['String'];
  endpoint: Scalars['String'];
};

export type IlpAccount = {
  __typename?: 'IlpAccount';
  id: Scalars['ID'];
  disabled: Scalars['Boolean'];
  superAccountId?: Maybe<Scalars['ID']>;
  superAccount?: Maybe<IlpAccount>;
  subAccounts: IlpAccountsConnection;
  liquidityAccountId?: Maybe<Scalars['ID']>;
  maxPacketAmount: Scalars['UInt64'];
  http: Http;
  asset: Asset;
  stream: Stream;
  routing: Routing;
  balance: Balance;
  webhooks: WebhooksConnection;
  deposits: DepositsConnection;
  withdrawals: WithdrawalsConnection;
};


export type IlpAccountSubAccountsArgs = {
  after?: Maybe<Scalars['String']>;
  before?: Maybe<Scalars['String']>;
  first?: Maybe<Scalars['Int']>;
  last?: Maybe<Scalars['Int']>;
};


export type IlpAccountWebhooksArgs = {
  after?: Maybe<Scalars['String']>;
  before?: Maybe<Scalars['String']>;
  first?: Maybe<Scalars['Int']>;
  last?: Maybe<Scalars['Int']>;
};


export type IlpAccountDepositsArgs = {
  after?: Maybe<Scalars['String']>;
  before?: Maybe<Scalars['String']>;
  first?: Maybe<Scalars['Int']>;
  last?: Maybe<Scalars['Int']>;
};


export type IlpAccountWithdrawalsArgs = {
  after?: Maybe<Scalars['String']>;
  before?: Maybe<Scalars['String']>;
  first?: Maybe<Scalars['Int']>;
  last?: Maybe<Scalars['Int']>;
};

export type IlpAccountEdge = {
  __typename?: 'IlpAccountEdge';
  node: IlpAccount;
  cursor: Scalars['String'];
};

export type IlpAccountsConnection = {
  __typename?: 'IlpAccountsConnection';
  pageInfo: PageInfo;
  edges: Array<IlpAccountEdge>;
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Create Interledger account */
  createIlpAccount: CreateIlpAccountMutationResponse;
  /** Update Interledger account */
  updateIlpAccount: UpdateIlpAccountMutationResponse;
  /** Delete Interledger account */
  deleteIlpAccount: DeleteIlpAccountMutationResponse;
  /** Create Interledger sub-account */
  createIlpSubAccount: CreateIlpSubAccountMutationResponse;
  /** Transfer between Interledger accounts */
  transfer?: Maybe<TransferMutationResponse>;
  /** Extend credit */
  extendCredit?: Maybe<ExtendCreditMutationResponse>;
  /** Revoke credit */
  revokeCredit?: Maybe<RevokeCreditMutationResponse>;
  /** Utilize credit */
  utilizeCredit?: Maybe<RevokeCreditMutationResponse>;
  /** Settle debt */
  settleDebt?: Maybe<SettleDebtMutationResponse>;
  /** Create webhook */
  createWebhook?: Maybe<CreateWebhookMutationResponse>;
  /** Update webhook */
  updateWebhook?: Maybe<UpdateWebhookMutationResponse>;
  /** Delete webhook */
  deleteWebhook?: Maybe<DeleteWebhookMutationResponse>;
  /** Create deposit */
  createDeposit?: Maybe<CreateDepositMutationResponse>;
  /** Create withdrawal */
  createWithdrawal?: Maybe<CreateWithdrawalMutationResponse>;
  /** Finalize pending withdrawal */
  finalizePendingWithdrawal?: Maybe<FinalizePendingWithdrawalMutationResponse>;
  /** Rollback pending withdrawal */
  rollbackPendingWithdrawal?: Maybe<RollbackPendingWithdrawalMutationResponse>;
};


export type MutationCreateIlpAccountArgs = {
  input: CreateIlpAccountInput;
};


export type MutationUpdateIlpAccountArgs = {
  input: UpdateIlpAccountInput;
};


export type MutationDeleteIlpAccountArgs = {
  id: Scalars['ID'];
};


export type MutationCreateIlpSubAccountArgs = {
  superAccountId: Scalars['ID'];
};


export type MutationTransferArgs = {
  input: TransferInput;
};


export type MutationExtendCreditArgs = {
  accountId: Scalars['ID'];
  subAccountId: Scalars['ID'];
  amount: Scalars['UInt64'];
  autoApply?: Scalars['Boolean'];
};


export type MutationRevokeCreditArgs = {
  accountId: Scalars['ID'];
  subAccountId: Scalars['ID'];
  amount: Scalars['UInt64'];
};


export type MutationUtilizeCreditArgs = {
  accountId: Scalars['ID'];
  subAccountId: Scalars['ID'];
  amount: Scalars['UInt64'];
};


export type MutationSettleDebtArgs = {
  accountId: Scalars['ID'];
  subAccountId: Scalars['ID'];
  amount: Scalars['UInt64'];
  revolve?: Scalars['Boolean'];
};


export type MutationCreateWebhookArgs = {
  ilpAccountId: Scalars['ID'];
};


export type MutationUpdateWebhookArgs = {
  webhookId: Scalars['ID'];
};


export type MutationDeleteWebhookArgs = {
  webhookId: Scalars['ID'];
};


export type MutationCreateDepositArgs = {
  input: CreateDepositInput;
};


export type MutationCreateWithdrawalArgs = {
  ilpAccountId: Scalars['ID'];
  amount: Scalars['UInt64'];
  id?: Maybe<Scalars['ID']>;
};


export type MutationFinalizePendingWithdrawalArgs = {
  withdrawalId: Scalars['ID'];
};


export type MutationRollbackPendingWithdrawalArgs = {
  withdrawalId: Scalars['ID'];
};

export type MutationResponse = {
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type Operator = {
  __typename?: 'Operator';
  availableCredit: Scalars['UInt64'];
  totalBorrowed: Scalars['UInt64'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  /** Paginating forwards: the cursor to continue. */
  endCursor?: Maybe<Scalars['String']>;
  /** Paginating forwards: Are there more pages? */
  hasNextPage: Scalars['Boolean'];
  /** Paginating backwards: Are there more pages? */
  hasPreviousPage: Scalars['Boolean'];
  /** Paginating backwards: the cursor to continue. */
  startCursor?: Maybe<Scalars['String']>;
};

export type Query = {
  __typename?: 'Query';
  /** Fetch a page of Interledger accounts. */
  ilpAccounts: IlpAccountsConnection;
  /** Get an Interledger account by ID. */
  ilpAccount: IlpAccount;
  /** Get a webhook by ID. */
  webhook: Webhook;
  /** Get a deposit by ID. */
  deposit: Deposit;
  /** Get a withdrawal by ID. */
  withdrawal: Withdrawal;
};


export type QueryIlpAccountsArgs = {
  after?: Maybe<Scalars['String']>;
  before?: Maybe<Scalars['String']>;
  first?: Maybe<Scalars['Int']>;
  last?: Maybe<Scalars['Int']>;
};


export type QueryIlpAccountArgs = {
  id: Scalars['ID'];
  withSubAccounts?: Maybe<Scalars['Boolean']>;
};


export type QueryWebhookArgs = {
  id: Scalars['ID'];
};


export type QueryDepositArgs = {
  id: Scalars['ID'];
};


export type QueryWithdrawalArgs = {
  id: Scalars['ID'];
};

export type RevokeCreditMutationResponse = MutationResponse & {
  __typename?: 'RevokeCreditMutationResponse';
  code: Scalars['String'];
  message: Scalars['String'];
  success: Scalars['Boolean'];
};

export type RollbackPendingWithdrawalMutationResponse = MutationResponse & {
  __typename?: 'RollbackPendingWithdrawalMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type Routing = {
  __typename?: 'Routing';
  staticIlpAddress: Scalars['String'];
  inheritFromRemote: Scalars['Boolean'];
  dynamicIlpAddress?: Maybe<Scalars['String']>;
};

export type RoutingInput = {
  staticIlpAddress: Scalars['String'];
};

export type SettleDebtMutationResponse = MutationResponse & {
  __typename?: 'SettleDebtMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};

export type Stream = {
  __typename?: 'Stream';
  enabled: Scalars['Boolean'];
};

export type StreamInput = {
  enabled: Scalars['Boolean'];
};

export type TransferInput = {
  sourceAccountId: Scalars['ID'];
  sourceAmount: Scalars['String'];
  destinationAccountId: Scalars['ID'];
  destinationAmount?: Maybe<Scalars['String']>;
  autoCommit?: Maybe<Scalars['Boolean']>;
  idempotencyKey: Scalars['ID'];
};

export type TransferMutationResponse = MutationResponse & {
  __typename?: 'TransferMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
};


export type UpdateIlpAccountInput = {
  id?: Maybe<Scalars['ID']>;
  disabled?: Maybe<Scalars['Boolean']>;
  maxPacketAmount?: Maybe<Scalars['String']>;
  http?: Maybe<HttpInput>;
  stream?: Maybe<StreamInput>;
  routing?: Maybe<RoutingInput>;
};

export type UpdateIlpAccountMutationResponse = MutationResponse & {
  __typename?: 'UpdateIlpAccountMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  ilpAccount: IlpAccount;
};

export type UpdateWebhookMutationResponse = MutationResponse & {
  __typename?: 'UpdateWebhookMutationResponse';
  code: Scalars['String'];
  success: Scalars['Boolean'];
  message: Scalars['String'];
  webhook: Webhook;
};

export type Webhook = {
  __typename?: 'Webhook';
  id: Scalars['ID'];
};

export type WebhookEdge = {
  __typename?: 'WebhookEdge';
  node: Webhook;
  cursor: Scalars['String'];
};

export type WebhooksConnection = {
  __typename?: 'WebhooksConnection';
  pageInfo: PageInfo;
  edges: Array<WebhookEdge>;
};

export type Withdrawal = {
  __typename?: 'Withdrawal';
  id: Scalars['ID'];
  amount: Scalars['UInt64'];
  createdTime: Scalars['Int'];
  finalizedTime?: Maybe<Scalars['Int']>;
};

export type WithdrawalEdge = {
  __typename?: 'WithdrawalEdge';
  node: Withdrawal;
  cursor: Scalars['String'];
};

export type WithdrawalsConnection = {
  __typename?: 'WithdrawalsConnection';
  pageInfo: PageInfo;
  edges: Array<WithdrawalEdge>;
};



export type ResolverTypeWrapper<T> = Promise<T>;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};

export type LegacyStitchingResolver<TResult, TParent, TContext, TArgs> = {
  fragment: string;
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};

export type NewStitchingResolver<TResult, TParent, TContext, TArgs> = {
  selectionSet: string;
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type StitchingResolver<TResult, TParent, TContext, TArgs> = LegacyStitchingResolver<TResult, TParent, TContext, TArgs> | NewStitchingResolver<TResult, TParent, TContext, TArgs>;
export type Resolver<TResult, TParent = {}, TContext = {}, TArgs = {}> =
  | ResolverFn<TResult, TParent, TContext, TArgs>
  | ResolverWithResolve<TResult, TParent, TContext, TArgs>
  | StitchingResolver<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterator<TResult> | Promise<AsyncIterator<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = {}, TContext = {}, TArgs = {}> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = {}, TContext = {}> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = {}, TContext = {}> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = {}, TParent = {}, TContext = {}, TArgs = {}> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Amount: ResolverTypeWrapper<Partial<Amount>>;
  String: ResolverTypeWrapper<Partial<Scalars['String']>>;
  Int: ResolverTypeWrapper<Partial<Scalars['Int']>>;
  Asset: ResolverTypeWrapper<Partial<Asset>>;
  AssetInput: ResolverTypeWrapper<Partial<AssetInput>>;
  Balance: ResolverTypeWrapper<Partial<Balance>>;
  ID: ResolverTypeWrapper<Partial<Scalars['ID']>>;
  CreateDepositInput: ResolverTypeWrapper<Partial<CreateDepositInput>>;
  CreateDepositMutationResponse: ResolverTypeWrapper<Partial<CreateDepositMutationResponse>>;
  Boolean: ResolverTypeWrapper<Partial<Scalars['Boolean']>>;
  CreateIlpAccountInput: ResolverTypeWrapper<Partial<CreateIlpAccountInput>>;
  CreateIlpAccountMutationResponse: ResolverTypeWrapper<Partial<CreateIlpAccountMutationResponse>>;
  CreateIlpSubAccountMutationResponse: ResolverTypeWrapper<Partial<CreateIlpSubAccountMutationResponse>>;
  CreateWebhookMutationResponse: ResolverTypeWrapper<Partial<CreateWebhookMutationResponse>>;
  CreateWithdrawalMutationResponse: ResolverTypeWrapper<Partial<CreateWithdrawalMutationResponse>>;
  DeleteIlpAccountMutationResponse: ResolverTypeWrapper<Partial<DeleteIlpAccountMutationResponse>>;
  DeleteWebhookMutationResponse: ResolverTypeWrapper<Partial<DeleteWebhookMutationResponse>>;
  Deposit: ResolverTypeWrapper<Partial<Deposit>>;
  DepositEdge: ResolverTypeWrapper<Partial<DepositEdge>>;
  DepositsConnection: ResolverTypeWrapper<Partial<DepositsConnection>>;
  ExtendCreditMutationResponse: ResolverTypeWrapper<Partial<ExtendCreditMutationResponse>>;
  FinalizePendingWithdrawalMutationResponse: ResolverTypeWrapper<Partial<FinalizePendingWithdrawalMutationResponse>>;
  Http: ResolverTypeWrapper<Partial<Http>>;
  HttpIncoming: ResolverTypeWrapper<Partial<HttpIncoming>>;
  HttpIncomingInput: ResolverTypeWrapper<Partial<HttpIncomingInput>>;
  HttpInput: ResolverTypeWrapper<Partial<HttpInput>>;
  HttpOutgoing: ResolverTypeWrapper<Partial<HttpOutgoing>>;
  HttpOutgoingInput: ResolverTypeWrapper<Partial<HttpOutgoingInput>>;
  IlpAccount: ResolverTypeWrapper<Partial<IlpAccount>>;
  IlpAccountEdge: ResolverTypeWrapper<Partial<IlpAccountEdge>>;
  IlpAccountsConnection: ResolverTypeWrapper<Partial<IlpAccountsConnection>>;
  Mutation: ResolverTypeWrapper<{}>;
  MutationResponse: ResolversTypes['CreateDepositMutationResponse'] | ResolversTypes['CreateIlpAccountMutationResponse'] | ResolversTypes['CreateIlpSubAccountMutationResponse'] | ResolversTypes['CreateWebhookMutationResponse'] | ResolversTypes['CreateWithdrawalMutationResponse'] | ResolversTypes['DeleteIlpAccountMutationResponse'] | ResolversTypes['DeleteWebhookMutationResponse'] | ResolversTypes['ExtendCreditMutationResponse'] | ResolversTypes['FinalizePendingWithdrawalMutationResponse'] | ResolversTypes['RevokeCreditMutationResponse'] | ResolversTypes['RollbackPendingWithdrawalMutationResponse'] | ResolversTypes['SettleDebtMutationResponse'] | ResolversTypes['TransferMutationResponse'] | ResolversTypes['UpdateIlpAccountMutationResponse'] | ResolversTypes['UpdateWebhookMutationResponse'];
  Operator: ResolverTypeWrapper<Partial<Operator>>;
  PageInfo: ResolverTypeWrapper<Partial<PageInfo>>;
  Query: ResolverTypeWrapper<{}>;
  RevokeCreditMutationResponse: ResolverTypeWrapper<Partial<RevokeCreditMutationResponse>>;
  RollbackPendingWithdrawalMutationResponse: ResolverTypeWrapper<Partial<RollbackPendingWithdrawalMutationResponse>>;
  Routing: ResolverTypeWrapper<Partial<Routing>>;
  RoutingInput: ResolverTypeWrapper<Partial<RoutingInput>>;
  SettleDebtMutationResponse: ResolverTypeWrapper<Partial<SettleDebtMutationResponse>>;
  Stream: ResolverTypeWrapper<Partial<Stream>>;
  StreamInput: ResolverTypeWrapper<Partial<StreamInput>>;
  TransferInput: ResolverTypeWrapper<Partial<TransferInput>>;
  TransferMutationResponse: ResolverTypeWrapper<Partial<TransferMutationResponse>>;
  UInt64: ResolverTypeWrapper<Partial<Scalars['UInt64']>>;
  UpdateIlpAccountInput: ResolverTypeWrapper<Partial<UpdateIlpAccountInput>>;
  UpdateIlpAccountMutationResponse: ResolverTypeWrapper<Partial<UpdateIlpAccountMutationResponse>>;
  UpdateWebhookMutationResponse: ResolverTypeWrapper<Partial<UpdateWebhookMutationResponse>>;
  Webhook: ResolverTypeWrapper<Partial<Webhook>>;
  WebhookEdge: ResolverTypeWrapper<Partial<WebhookEdge>>;
  WebhooksConnection: ResolverTypeWrapper<Partial<WebhooksConnection>>;
  Withdrawal: ResolverTypeWrapper<Partial<Withdrawal>>;
  WithdrawalEdge: ResolverTypeWrapper<Partial<WithdrawalEdge>>;
  WithdrawalsConnection: ResolverTypeWrapper<Partial<WithdrawalsConnection>>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Amount: Partial<Amount>;
  String: Partial<Scalars['String']>;
  Int: Partial<Scalars['Int']>;
  Asset: Partial<Asset>;
  AssetInput: Partial<AssetInput>;
  Balance: Partial<Balance>;
  ID: Partial<Scalars['ID']>;
  CreateDepositInput: Partial<CreateDepositInput>;
  CreateDepositMutationResponse: Partial<CreateDepositMutationResponse>;
  Boolean: Partial<Scalars['Boolean']>;
  CreateIlpAccountInput: Partial<CreateIlpAccountInput>;
  CreateIlpAccountMutationResponse: Partial<CreateIlpAccountMutationResponse>;
  CreateIlpSubAccountMutationResponse: Partial<CreateIlpSubAccountMutationResponse>;
  CreateWebhookMutationResponse: Partial<CreateWebhookMutationResponse>;
  CreateWithdrawalMutationResponse: Partial<CreateWithdrawalMutationResponse>;
  DeleteIlpAccountMutationResponse: Partial<DeleteIlpAccountMutationResponse>;
  DeleteWebhookMutationResponse: Partial<DeleteWebhookMutationResponse>;
  Deposit: Partial<Deposit>;
  DepositEdge: Partial<DepositEdge>;
  DepositsConnection: Partial<DepositsConnection>;
  ExtendCreditMutationResponse: Partial<ExtendCreditMutationResponse>;
  FinalizePendingWithdrawalMutationResponse: Partial<FinalizePendingWithdrawalMutationResponse>;
  Http: Partial<Http>;
  HttpIncoming: Partial<HttpIncoming>;
  HttpIncomingInput: Partial<HttpIncomingInput>;
  HttpInput: Partial<HttpInput>;
  HttpOutgoing: Partial<HttpOutgoing>;
  HttpOutgoingInput: Partial<HttpOutgoingInput>;
  IlpAccount: Partial<IlpAccount>;
  IlpAccountEdge: Partial<IlpAccountEdge>;
  IlpAccountsConnection: Partial<IlpAccountsConnection>;
  Mutation: {};
  MutationResponse: ResolversParentTypes['CreateDepositMutationResponse'] | ResolversParentTypes['CreateIlpAccountMutationResponse'] | ResolversParentTypes['CreateIlpSubAccountMutationResponse'] | ResolversParentTypes['CreateWebhookMutationResponse'] | ResolversParentTypes['CreateWithdrawalMutationResponse'] | ResolversParentTypes['DeleteIlpAccountMutationResponse'] | ResolversParentTypes['DeleteWebhookMutationResponse'] | ResolversParentTypes['ExtendCreditMutationResponse'] | ResolversParentTypes['FinalizePendingWithdrawalMutationResponse'] | ResolversParentTypes['RevokeCreditMutationResponse'] | ResolversParentTypes['RollbackPendingWithdrawalMutationResponse'] | ResolversParentTypes['SettleDebtMutationResponse'] | ResolversParentTypes['TransferMutationResponse'] | ResolversParentTypes['UpdateIlpAccountMutationResponse'] | ResolversParentTypes['UpdateWebhookMutationResponse'];
  Operator: Partial<Operator>;
  PageInfo: Partial<PageInfo>;
  Query: {};
  RevokeCreditMutationResponse: Partial<RevokeCreditMutationResponse>;
  RollbackPendingWithdrawalMutationResponse: Partial<RollbackPendingWithdrawalMutationResponse>;
  Routing: Partial<Routing>;
  RoutingInput: Partial<RoutingInput>;
  SettleDebtMutationResponse: Partial<SettleDebtMutationResponse>;
  Stream: Partial<Stream>;
  StreamInput: Partial<StreamInput>;
  TransferInput: Partial<TransferInput>;
  TransferMutationResponse: Partial<TransferMutationResponse>;
  UInt64: Partial<Scalars['UInt64']>;
  UpdateIlpAccountInput: Partial<UpdateIlpAccountInput>;
  UpdateIlpAccountMutationResponse: Partial<UpdateIlpAccountMutationResponse>;
  UpdateWebhookMutationResponse: Partial<UpdateWebhookMutationResponse>;
  Webhook: Partial<Webhook>;
  WebhookEdge: Partial<WebhookEdge>;
  WebhooksConnection: Partial<WebhooksConnection>;
  Withdrawal: Partial<Withdrawal>;
  WithdrawalEdge: Partial<WithdrawalEdge>;
  WithdrawalsConnection: Partial<WithdrawalsConnection>;
};

export type AmountResolvers<ContextType = any, ParentType extends ResolversParentTypes['Amount'] = ResolversParentTypes['Amount']> = {
  amount?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  currency?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scale?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type AssetResolvers<ContextType = any, ParentType extends ResolversParentTypes['Asset'] = ResolversParentTypes['Asset']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  scale?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type BalanceResolvers<ContextType = any, ParentType extends ResolversParentTypes['Balance'] = ResolversParentTypes['Balance']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  createdTime?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  asset?: Resolver<ResolversTypes['Asset'], ParentType, ContextType>;
  balance?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  netLiability?: Resolver<Maybe<ResolversTypes['UInt64']>, ParentType, ContextType>;
  netAssets?: Resolver<Maybe<ResolversTypes['UInt64']>, ParentType, ContextType>;
  creditExtended?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  totalLent?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  operator?: Resolver<Maybe<ResolversTypes['Operator']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateDepositMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateDepositMutationResponse'] = ResolversParentTypes['CreateDepositMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  deposit?: Resolver<Maybe<ResolversTypes['Deposit']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateIlpAccountMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateIlpAccountMutationResponse'] = ResolversParentTypes['CreateIlpAccountMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ilpAccount?: Resolver<ResolversTypes['IlpAccount'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateIlpSubAccountMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateIlpSubAccountMutationResponse'] = ResolversParentTypes['CreateIlpSubAccountMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ilpAccount?: Resolver<ResolversTypes['IlpAccount'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateWebhookMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateWebhookMutationResponse'] = ResolversParentTypes['CreateWebhookMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  webhook?: Resolver<ResolversTypes['Webhook'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateWithdrawalMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateWithdrawalMutationResponse'] = ResolversParentTypes['CreateWithdrawalMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  withdrawal?: Resolver<ResolversTypes['Withdrawal'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DeleteIlpAccountMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeleteIlpAccountMutationResponse'] = ResolversParentTypes['DeleteIlpAccountMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DeleteWebhookMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeleteWebhookMutationResponse'] = ResolversParentTypes['DeleteWebhookMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DepositResolvers<ContextType = any, ParentType extends ResolversParentTypes['Deposit'] = ResolversParentTypes['Deposit']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  amount?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  ilpAccountId?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DepositEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['DepositEdge'] = ResolversParentTypes['DepositEdge']> = {
  node?: Resolver<ResolversTypes['Deposit'], ParentType, ContextType>;
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type DepositsConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['DepositsConnection'] = ResolversParentTypes['DepositsConnection']> = {
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['DepositEdge']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type ExtendCreditMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['ExtendCreditMutationResponse'] = ResolversParentTypes['ExtendCreditMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type FinalizePendingWithdrawalMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['FinalizePendingWithdrawalMutationResponse'] = ResolversParentTypes['FinalizePendingWithdrawalMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type HttpResolvers<ContextType = any, ParentType extends ResolversParentTypes['Http'] = ResolversParentTypes['Http']> = {
  incoming?: Resolver<ResolversTypes['HttpIncoming'], ParentType, ContextType>;
  outgoing?: Resolver<ResolversTypes['HttpOutgoing'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type HttpIncomingResolvers<ContextType = any, ParentType extends ResolversParentTypes['HttpIncoming'] = ResolversParentTypes['HttpIncoming']> = {
  authTokens?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type HttpOutgoingResolvers<ContextType = any, ParentType extends ResolversParentTypes['HttpOutgoing'] = ResolversParentTypes['HttpOutgoing']> = {
  authToken?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  endpoint?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type IlpAccountResolvers<ContextType = any, ParentType extends ResolversParentTypes['IlpAccount'] = ResolversParentTypes['IlpAccount']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  disabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  superAccountId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  superAccount?: Resolver<Maybe<ResolversTypes['IlpAccount']>, ParentType, ContextType>;
  subAccounts?: Resolver<ResolversTypes['IlpAccountsConnection'], ParentType, ContextType, RequireFields<IlpAccountSubAccountsArgs, never>>;
  liquidityAccountId?: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
  maxPacketAmount?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  http?: Resolver<ResolversTypes['Http'], ParentType, ContextType>;
  asset?: Resolver<ResolversTypes['Asset'], ParentType, ContextType>;
  stream?: Resolver<ResolversTypes['Stream'], ParentType, ContextType>;
  routing?: Resolver<ResolversTypes['Routing'], ParentType, ContextType>;
  balance?: Resolver<ResolversTypes['Balance'], ParentType, ContextType>;
  webhooks?: Resolver<ResolversTypes['WebhooksConnection'], ParentType, ContextType, RequireFields<IlpAccountWebhooksArgs, never>>;
  deposits?: Resolver<ResolversTypes['DepositsConnection'], ParentType, ContextType, RequireFields<IlpAccountDepositsArgs, never>>;
  withdrawals?: Resolver<ResolversTypes['WithdrawalsConnection'], ParentType, ContextType, RequireFields<IlpAccountWithdrawalsArgs, never>>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type IlpAccountEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['IlpAccountEdge'] = ResolversParentTypes['IlpAccountEdge']> = {
  node?: Resolver<ResolversTypes['IlpAccount'], ParentType, ContextType>;
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type IlpAccountsConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['IlpAccountsConnection'] = ResolversParentTypes['IlpAccountsConnection']> = {
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['IlpAccountEdge']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  createIlpAccount?: Resolver<ResolversTypes['CreateIlpAccountMutationResponse'], ParentType, ContextType, RequireFields<MutationCreateIlpAccountArgs, 'input'>>;
  updateIlpAccount?: Resolver<ResolversTypes['UpdateIlpAccountMutationResponse'], ParentType, ContextType, RequireFields<MutationUpdateIlpAccountArgs, 'input'>>;
  deleteIlpAccount?: Resolver<ResolversTypes['DeleteIlpAccountMutationResponse'], ParentType, ContextType, RequireFields<MutationDeleteIlpAccountArgs, 'id'>>;
  createIlpSubAccount?: Resolver<ResolversTypes['CreateIlpSubAccountMutationResponse'], ParentType, ContextType, RequireFields<MutationCreateIlpSubAccountArgs, 'superAccountId'>>;
  transfer?: Resolver<Maybe<ResolversTypes['TransferMutationResponse']>, ParentType, ContextType, RequireFields<MutationTransferArgs, 'input'>>;
  extendCredit?: Resolver<Maybe<ResolversTypes['ExtendCreditMutationResponse']>, ParentType, ContextType, RequireFields<MutationExtendCreditArgs, 'accountId' | 'subAccountId' | 'amount' | 'autoApply'>>;
  revokeCredit?: Resolver<Maybe<ResolversTypes['RevokeCreditMutationResponse']>, ParentType, ContextType, RequireFields<MutationRevokeCreditArgs, 'accountId' | 'subAccountId' | 'amount'>>;
  utilizeCredit?: Resolver<Maybe<ResolversTypes['RevokeCreditMutationResponse']>, ParentType, ContextType, RequireFields<MutationUtilizeCreditArgs, 'accountId' | 'subAccountId' | 'amount'>>;
  settleDebt?: Resolver<Maybe<ResolversTypes['SettleDebtMutationResponse']>, ParentType, ContextType, RequireFields<MutationSettleDebtArgs, 'accountId' | 'subAccountId' | 'amount' | 'revolve'>>;
  createWebhook?: Resolver<Maybe<ResolversTypes['CreateWebhookMutationResponse']>, ParentType, ContextType, RequireFields<MutationCreateWebhookArgs, 'ilpAccountId'>>;
  updateWebhook?: Resolver<Maybe<ResolversTypes['UpdateWebhookMutationResponse']>, ParentType, ContextType, RequireFields<MutationUpdateWebhookArgs, 'webhookId'>>;
  deleteWebhook?: Resolver<Maybe<ResolversTypes['DeleteWebhookMutationResponse']>, ParentType, ContextType, RequireFields<MutationDeleteWebhookArgs, 'webhookId'>>;
  createDeposit?: Resolver<Maybe<ResolversTypes['CreateDepositMutationResponse']>, ParentType, ContextType, RequireFields<MutationCreateDepositArgs, 'input'>>;
  createWithdrawal?: Resolver<Maybe<ResolversTypes['CreateWithdrawalMutationResponse']>, ParentType, ContextType, RequireFields<MutationCreateWithdrawalArgs, 'ilpAccountId' | 'amount'>>;
  finalizePendingWithdrawal?: Resolver<Maybe<ResolversTypes['FinalizePendingWithdrawalMutationResponse']>, ParentType, ContextType, RequireFields<MutationFinalizePendingWithdrawalArgs, 'withdrawalId'>>;
  rollbackPendingWithdrawal?: Resolver<Maybe<ResolversTypes['RollbackPendingWithdrawalMutationResponse']>, ParentType, ContextType, RequireFields<MutationRollbackPendingWithdrawalArgs, 'withdrawalId'>>;
};

export type MutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['MutationResponse'] = ResolversParentTypes['MutationResponse']> = {
  __resolveType: TypeResolveFn<'CreateDepositMutationResponse' | 'CreateIlpAccountMutationResponse' | 'CreateIlpSubAccountMutationResponse' | 'CreateWebhookMutationResponse' | 'CreateWithdrawalMutationResponse' | 'DeleteIlpAccountMutationResponse' | 'DeleteWebhookMutationResponse' | 'ExtendCreditMutationResponse' | 'FinalizePendingWithdrawalMutationResponse' | 'RevokeCreditMutationResponse' | 'RollbackPendingWithdrawalMutationResponse' | 'SettleDebtMutationResponse' | 'TransferMutationResponse' | 'UpdateIlpAccountMutationResponse' | 'UpdateWebhookMutationResponse', ParentType, ContextType>;
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type OperatorResolvers<ContextType = any, ParentType extends ResolversParentTypes['Operator'] = ResolversParentTypes['Operator']> = {
  availableCredit?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  totalBorrowed?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = any, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  hasPreviousPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  startCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  ilpAccounts?: Resolver<ResolversTypes['IlpAccountsConnection'], ParentType, ContextType, RequireFields<QueryIlpAccountsArgs, never>>;
  ilpAccount?: Resolver<ResolversTypes['IlpAccount'], ParentType, ContextType, RequireFields<QueryIlpAccountArgs, 'id'>>;
  webhook?: Resolver<ResolversTypes['Webhook'], ParentType, ContextType, RequireFields<QueryWebhookArgs, 'id'>>;
  deposit?: Resolver<ResolversTypes['Deposit'], ParentType, ContextType, RequireFields<QueryDepositArgs, 'id'>>;
  withdrawal?: Resolver<ResolversTypes['Withdrawal'], ParentType, ContextType, RequireFields<QueryWithdrawalArgs, 'id'>>;
};

export type RevokeCreditMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['RevokeCreditMutationResponse'] = ResolversParentTypes['RevokeCreditMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RollbackPendingWithdrawalMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['RollbackPendingWithdrawalMutationResponse'] = ResolversParentTypes['RollbackPendingWithdrawalMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RoutingResolvers<ContextType = any, ParentType extends ResolversParentTypes['Routing'] = ResolversParentTypes['Routing']> = {
  staticIlpAddress?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  inheritFromRemote?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  dynamicIlpAddress?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type SettleDebtMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['SettleDebtMutationResponse'] = ResolversParentTypes['SettleDebtMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type StreamResolvers<ContextType = any, ParentType extends ResolversParentTypes['Stream'] = ResolversParentTypes['Stream']> = {
  enabled?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type TransferMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['TransferMutationResponse'] = ResolversParentTypes['TransferMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export interface UInt64ScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['UInt64'], any> {
  name: 'UInt64';
}

export type UpdateIlpAccountMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['UpdateIlpAccountMutationResponse'] = ResolversParentTypes['UpdateIlpAccountMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ilpAccount?: Resolver<ResolversTypes['IlpAccount'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type UpdateWebhookMutationResponseResolvers<ContextType = any, ParentType extends ResolversParentTypes['UpdateWebhookMutationResponse'] = ResolversParentTypes['UpdateWebhookMutationResponse']> = {
  code?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  success?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  webhook?: Resolver<ResolversTypes['Webhook'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WebhookResolvers<ContextType = any, ParentType extends ResolversParentTypes['Webhook'] = ResolversParentTypes['Webhook']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WebhookEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['WebhookEdge'] = ResolversParentTypes['WebhookEdge']> = {
  node?: Resolver<ResolversTypes['Webhook'], ParentType, ContextType>;
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WebhooksConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['WebhooksConnection'] = ResolversParentTypes['WebhooksConnection']> = {
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['WebhookEdge']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WithdrawalResolvers<ContextType = any, ParentType extends ResolversParentTypes['Withdrawal'] = ResolversParentTypes['Withdrawal']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  amount?: Resolver<ResolversTypes['UInt64'], ParentType, ContextType>;
  createdTime?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  finalizedTime?: Resolver<Maybe<ResolversTypes['Int']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WithdrawalEdgeResolvers<ContextType = any, ParentType extends ResolversParentTypes['WithdrawalEdge'] = ResolversParentTypes['WithdrawalEdge']> = {
  node?: Resolver<ResolversTypes['Withdrawal'], ParentType, ContextType>;
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WithdrawalsConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['WithdrawalsConnection'] = ResolversParentTypes['WithdrawalsConnection']> = {
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  edges?: Resolver<Array<ResolversTypes['WithdrawalEdge']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type Resolvers<ContextType = any> = {
  Amount?: AmountResolvers<ContextType>;
  Asset?: AssetResolvers<ContextType>;
  Balance?: BalanceResolvers<ContextType>;
  CreateDepositMutationResponse?: CreateDepositMutationResponseResolvers<ContextType>;
  CreateIlpAccountMutationResponse?: CreateIlpAccountMutationResponseResolvers<ContextType>;
  CreateIlpSubAccountMutationResponse?: CreateIlpSubAccountMutationResponseResolvers<ContextType>;
  CreateWebhookMutationResponse?: CreateWebhookMutationResponseResolvers<ContextType>;
  CreateWithdrawalMutationResponse?: CreateWithdrawalMutationResponseResolvers<ContextType>;
  DeleteIlpAccountMutationResponse?: DeleteIlpAccountMutationResponseResolvers<ContextType>;
  DeleteWebhookMutationResponse?: DeleteWebhookMutationResponseResolvers<ContextType>;
  Deposit?: DepositResolvers<ContextType>;
  DepositEdge?: DepositEdgeResolvers<ContextType>;
  DepositsConnection?: DepositsConnectionResolvers<ContextType>;
  ExtendCreditMutationResponse?: ExtendCreditMutationResponseResolvers<ContextType>;
  FinalizePendingWithdrawalMutationResponse?: FinalizePendingWithdrawalMutationResponseResolvers<ContextType>;
  Http?: HttpResolvers<ContextType>;
  HttpIncoming?: HttpIncomingResolvers<ContextType>;
  HttpOutgoing?: HttpOutgoingResolvers<ContextType>;
  IlpAccount?: IlpAccountResolvers<ContextType>;
  IlpAccountEdge?: IlpAccountEdgeResolvers<ContextType>;
  IlpAccountsConnection?: IlpAccountsConnectionResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  MutationResponse?: MutationResponseResolvers<ContextType>;
  Operator?: OperatorResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  RevokeCreditMutationResponse?: RevokeCreditMutationResponseResolvers<ContextType>;
  RollbackPendingWithdrawalMutationResponse?: RollbackPendingWithdrawalMutationResponseResolvers<ContextType>;
  Routing?: RoutingResolvers<ContextType>;
  SettleDebtMutationResponse?: SettleDebtMutationResponseResolvers<ContextType>;
  Stream?: StreamResolvers<ContextType>;
  TransferMutationResponse?: TransferMutationResponseResolvers<ContextType>;
  UInt64?: GraphQLScalarType;
  UpdateIlpAccountMutationResponse?: UpdateIlpAccountMutationResponseResolvers<ContextType>;
  UpdateWebhookMutationResponse?: UpdateWebhookMutationResponseResolvers<ContextType>;
  Webhook?: WebhookResolvers<ContextType>;
  WebhookEdge?: WebhookEdgeResolvers<ContextType>;
  WebhooksConnection?: WebhooksConnectionResolvers<ContextType>;
  Withdrawal?: WithdrawalResolvers<ContextType>;
  WithdrawalEdge?: WithdrawalEdgeResolvers<ContextType>;
  WithdrawalsConnection?: WithdrawalsConnectionResolvers<ContextType>;
};


/**
 * @deprecated
 * Use "Resolvers" root object instead. If you wish to get "IResolvers", add "typesPrefix: I" to your config.
 */
export type IResolvers<ContextType = any> = Resolvers<ContextType>;
