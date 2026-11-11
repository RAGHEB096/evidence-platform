import { z } from 'zod'

export const protocolDetailsSchema = z.object({
  reference: z.string().trim().min(1, 'Enter a reference.').max(64, 'At most 64 characters.'),
  name: z.string().trim().min(1, 'Enter a name.').max(200, 'At most 200 characters.'),
  version: z.string().trim().min(1, 'Enter a version.').max(32, 'At most 32 characters.'),
  description: z.string().max(10000, 'At most 10,000 characters.'),
})
