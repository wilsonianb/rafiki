/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */


/** Type helpers */
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;
type OneOf<T extends any[]> = T extends [infer Only] ? Only : T extends [infer A, infer B, ...infer Rest] ? OneOf<[XOR<A, B>, ...Rest]> : never;

export type paths = {
  "/": {
    /**
     * Grant Request 
     * @description Make a new grant request
     */
    post: operations["post-request"];
  };
  "/continue/{id}": {
    /**
     * Continuation Request 
     * @description Continue a grant request during or after user interaction.
     */
    post: operations["post-continue"];
    /**
     * Cancel Grant 
     * @description Cancel a grant request or delete a grant client side.
     */
    delete: operations["delete-continue"];
    parameters: {
      path: {
        id: string;
      };
    };
  };
  "/token/{id}": {
    /**
     * Rotate Access Token 
     * @description Management endpoint to rotate access token.
     */
    post: operations["post-token"];
    /**
     * Revoke Access Token 
     * @description Management endpoint to revoke access token.
     */
    delete: operations["delete-token"];
    parameters: {
      path: {
        id: string;
      };
    };
  };
};

export type components = {
  schemas: {
    /**
     * client 
     * @description Payment pointer of the client instance that is making this request.
     * 
     * When sending a non-continuation request to the AS, the client instance MUST identify itself by including the client field of the request and by signing the request.
     * 
     * A JSON Web Key Set document, including the public key that the client instance will use to protect this request and any continuation requests at the AS and any user-facing information about the client instance used in interactions, MUST be available at the payment pointer + `/jwks.json` url.
     * 
     * If sending a grant initiation request that requires RO interaction, the payment pointer MUST serve necessary client display information.
     */
    client: string;
    /**
     * interact 
     * @description The client instance declares the parameters for interaction methods that it can support using the interact field.
     */
    "interact-request": {
      /** @description Indicates how the client instance can start an interaction. */
      start: ("redirect")[];
      /** @description Indicates how the client instance can receive an indication that interaction has finished at the AS. */
      finish?: {
        /**
         * @description The callback method that the AS will use to contact the client instance. 
         * @enum {string}
         */
        method: "redirect";
        /**
         * Format: uri 
         * @description Indicates the URI that the AS will either send the RO to after interaction or send an HTTP POST request.
         */
        uri: string;
        /** @description Unique value to be used in the calculation of the "hash" query parameter sent to the callback URI, must be sufficiently random to be unguessable by an attacker.  MUST be generated by the client instance as a unique value for this request. */
        nonce: string;
      };
    };
    /** interact-response */
    "interact-response": {
      /**
       * Format: uri 
       * @description The URI to direct the end user to.
       */
      redirect: string;
      /** @description Unique key to secure the callback. */
      finish: string;
    };
    /**
     * continue 
     * @description If the AS determines that the request can be continued with additional requests, it responds with the continue field.
     */
    continue: {
      /** @description A unique access token for continuing the request, called the "continuation access token". */
      access_token: {
        value: string;
      };
      /**
       * Format: uri 
       * @description The URI at which the client instance can make continuation requests.
       */
      uri: string;
      /** @description The amount of time in integer seconds the client instance MUST wait after receiving this request continuation response and calling the continuation URI. */
      wait?: number;
    };
    /**
     * access_token 
     * @description A single access token or set of access tokens that the client instance can use to call the RS on behalf of the RO.
     */
    access_token: {
      /** @description The value of the access token as a string.  The value is opaque to the client instance.  The value SHOULD be limited to ASCII characters to facilitate transmission over HTTP headers within other protocols without requiring additional encoding. */
      value: string;
      /**
       * Format: uri 
       * @description The management URI for this access token. This URI MUST NOT include the access token value and SHOULD be different for each access token issued in a request.
       */
      manage: string;
      /** @description The number of seconds in which the access will expire.  The client instance MUST NOT use the access token past this time.  An RS MUST NOT accept an access token past this time. */
      expires_in?: number;
      access: external["schemas.yaml"]["components"]["schemas"]["access"];
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};

export type external = {

  "schemas.yaml": Record<string, never>
};

export type operations = {

  "post-request": {
    /**
     * Grant Request 
     * @description Make a new grant request
     */
    requestBody?: {
      content: {
        "application/json": {
          access_token: {
            access: external["schemas.yaml"]["components"]["schemas"]["access"];
          };
          client: components["schemas"]["client"];
          interact?: components["schemas"]["interact-request"];
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        content: {
          "application/json": OneOf<[{
            interact: components["schemas"]["interact-response"];
            continue: components["schemas"]["continue"];
          }, {
            access_token: components["schemas"]["access_token"];
            continue: components["schemas"]["continue"];
          }]>;
        };
      };
      /** @description Bad Request */
      400: never;
    };
  };
  "post-continue": {
    /**
     * Continuation Request 
     * @description Continue a grant request during or after user interaction.
     */
    requestBody?: {
      content: {
        "application/json": {
          /**
           * @description The interaction reference generated for this
           * interaction by the AS.
           */
          interact_ref: string;
        };
      };
    };
    responses: {
      /** @description Success */
      200: {
        content: {
          "application/json": {
            access_token?: components["schemas"]["access_token"];
            continue: components["schemas"]["continue"];
          };
        };
      };
      /** @description Unauthorized */
      401: never;
      /** @description Not Found */
      404: never;
    };
  };
  "delete-continue": {
    /**
     * Cancel Grant 
     * @description Cancel a grant request or delete a grant client side.
     */
    responses: {
      /** @description Accepted */
      202: never;
      /** @description Unauthorized */
      401: never;
      /** @description Not Found */
      404: never;
    };
  };
  "post-token": {
    /**
     * Rotate Access Token 
     * @description Management endpoint to rotate access token.
     */
    responses: {
      /** @description OK */
      200: {
        content: {
          "application/json": {
            access_token: components["schemas"]["access_token"];
          };
        };
      };
      /** @description Unauthorized */
      401: never;
      /** @description Not Found */
      404: never;
    };
  };
  "delete-token": {
    /**
     * Revoke Access Token 
     * @description Management endpoint to revoke access token.
     */
    responses: {
      /** @description No Content */
      204: never;
      /** @description Unauthorized */
      401: never;
    };
  };
};
