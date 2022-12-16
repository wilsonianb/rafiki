/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */

export interface paths {
  "/": {
    /** Introspect an access token to get grant details. */
    post: operations["post-introspect"];
    parameters: {};
  };
}

export interface components {
  schemas: {
    /**
     * key
     * @description A key presented by value MUST be a public key.
     */
    key: {
      /** @description The form of proof that the client instance will use when presenting the key. */
      proof: "httpsig";
      /**
       * Ed25519 Public Key
       * @description A JWK representation of an Ed25519 Public Key
       */
      jwk: {
        kid: string;
        /** @description The cryptographic algorithm family used with the key. The only allowed value is `EdDSA`. */
        alg: "EdDSA";
        use?: "sig";
        kty: "OKP";
        crv: "Ed25519";
        /** @description The base64 url-encoded public key. */
        x: string;
      };
    };
    /** token-info */
    "token-info": {
      active: true;
      grant: string;
      access: external["schemas.yaml"]["components"]["schemas"]["access"];
      key: components["schemas"]["key"];
      /** @description Opaque client identifier. */
      client_id: string;
    };
  };
}

export interface operations {
  /** Introspect an access token to get grant details. */
  "post-introspect": {
    parameters: {};
    responses: {
      /** OK */
      200: {
        content: {
          "application/json":
            | {
                active: false;
              }
            | components["schemas"]["token-info"];
        };
      };
      /** Not Found */
      404: unknown;
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description The access token value presented to the RS by the client instance. */
          access_token: string;
          access?: external["schemas.yaml"]["components"]["schemas"]["access"];
        };
      };
    };
  };
}

export interface external {
  "schemas.yaml": {
    paths: {};
    components: {
      schemas: {
        /** @description A description of the rights associated with this access token. */
        access: external["schemas.yaml"]["components"]["schemas"]["access-item"][];
        /** @description The access associated with the access token is described using objects that each contain multiple dimensions of access. */
        "access-item":
          | external["schemas.yaml"]["components"]["schemas"]["access-incoming"]
          | external["schemas.yaml"]["components"]["schemas"]["access-outgoing"]
          | external["schemas.yaml"]["components"]["schemas"]["access-quote"];
        /** access-incoming */
        "access-incoming": {
          /** @description The type of resource request as a string.  This field defines which other fields are allowed in the request object. */
          type: "incoming-payment";
          /** @description The types of actions the client instance will take at the RS as an array of strings. */
          actions: (
            | "create"
            | "complete"
            | "read"
            | "read-all"
            | "list"
            | "list-all"
          )[];
          /**
           * Format: uri
           * @description A string identifier indicating a specific resource at the RS.
           */
          identifier?: string;
        };
        /** access-outgoing */
        "access-outgoing": {
          /** @description The type of resource request as a string.  This field defines which other fields are allowed in the request object. */
          type: "outgoing-payment";
          /** @description The types of actions the client instance will take at the RS as an array of strings. */
          actions: ("create" | "read" | "read-all" | "list" | "list-all")[];
          /**
           * Format: uri
           * @description A string identifier indicating a specific resource at the RS.
           */
          identifier: string;
          limits?: external["schemas.yaml"]["components"]["schemas"]["limits-outgoing"];
        };
        /** access-quote */
        "access-quote": {
          /** @description The type of resource request as a string.  This field defines which other fields are allowed in the request object. */
          type: "quote";
          /** @description The types of actions the client instance will take at the RS as an array of strings. */
          actions: ("create" | "read" | "read-all")[];
        };
        /**
         * amount
         * @description All amounts are maxima, i.e. multiple payments can be created under a grant as long as the total amounts of these payments do not exceed the maximum amount per interval as specified in the grant.
         */
        amount: {
          /**
           * Format: uint64
           * @description The value is an unsigned 64-bit integer amount, represented as a string.
           */
          value: string;
          assetCode: external["schemas.yaml"]["components"]["schemas"]["assetCode"];
          assetScale: external["schemas.yaml"]["components"]["schemas"]["assetScale"];
        };
        /**
         * Asset code
         * @description The assetCode is a code that indicates the underlying asset. This SHOULD be an ISO4217 currency code.
         */
        assetCode: string;
        /**
         * Asset scale
         * @description The scale of amounts denoted in the corresponding asset code.
         */
        assetScale: number;
        /**
         * Interval
         * @description [ISO8601 repeating interval](https://en.wikipedia.org/wiki/ISO_8601#Repeating_intervals)
         */
        interval: string;
        /**
         * limits-outgoing
         * @description Open Payments specific property that defines the limits under which outgoing payments can be created.
         */
        "limits-outgoing": Partial<unknown> & {
          receiver?: external["schemas.yaml"]["components"]["schemas"]["receiver"];
          sendAmount?: external["schemas.yaml"]["components"]["schemas"]["amount"];
          receiveAmount?: external["schemas.yaml"]["components"]["schemas"]["amount"];
          interval?: external["schemas.yaml"]["components"]["schemas"]["interval"];
        };
        "list-actions": "list" | "list-all";
        "read-actions": "read" | "read-all";
        /**
         * Receiver
         * Format: uri
         * @description The URL of the incoming payment or ILP STREAM connection that is being paid.
         */
        receiver: string;
      };
    };
    operations: {};
  };
}
