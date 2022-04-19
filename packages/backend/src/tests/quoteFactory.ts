import assert from 'assert'
import nock from 'nock'
import { URL } from 'url'

import { isQuoteError } from '../open_payments/quote/errors'
import { Quote } from '../open_payments/quote/model'
import {
  CreateQuoteOptions,
  QuoteService
} from '../open_payments/quote/service'

export function mockWalletQuote(quoteUrl: string): nock.Scope {
  const url = new URL(quoteUrl)
  return nock(url.origin)
    .matchHeader('Accept', 'application/json')
    .matchHeader('Content-Type', 'application/json')
    .post(url.pathname)
    .reply(201, function (_path: string, requestBody: Record<string, unknown>) {
      return requestBody
    })
}

export class QuoteFactory {
  public constructor(
    private quoteUrl: string,
    private quoteService: QuoteService
  ) {}

  public async build(options: CreateQuoteOptions): Promise<Quote> {
    const scope = mockWalletQuote(this.quoteUrl)
    const quote = await this.quoteService.create(options)
    scope.isDone()
    assert.ok(!isQuoteError(quote))
    return quote
  }
}
