import { Grant, GrantJSON, GrantOptions } from './grant'
import { JWK } from 'http-signature-utils'

export interface KeyInfo {
  proof: string
  jwk: JWK
}

export interface TokenInfoJSON extends GrantJSON {
  key: KeyInfo
}

export class TokenInfo extends Grant {
  public readonly key: KeyInfo

  constructor(options: GrantOptions, key: KeyInfo) {
    super(options)
    this.key = key
  }

  public toJSON(): TokenInfoJSON {
    return {
      ...super.toJSON(),
      key: this.key
    }
  }
}
