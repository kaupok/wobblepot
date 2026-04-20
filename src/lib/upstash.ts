import { Redis } from '@upstash/redis'
import { serverEnv } from '@/lib/env'

let redisSingleton: Redis | null = null

export function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis({
      url: serverEnv.UPSTASH_REDIS_REST_URL,
      token: serverEnv.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return redisSingleton
}
