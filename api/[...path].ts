import { createApp } from '../server/app'
import type { Request, Response } from 'express'

const app = createApp()

export default function handler(request: Request, response: Response) {
  return app(request, response)
}
