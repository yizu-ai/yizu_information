import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const defaultUserProfilePath = 'F:\\software\\gbrain-master\\brain\\USER.md'
const defaultGbrainPath = 'C:\\Users\\yizu\\.bun\\bin\\gbrain.exe'

export async function readPersonalContext(query: string): Promise<string> {
  const [userProfile, gbrainContext] = await Promise.all([readUserProfile(), queryGbrain(query)])
  return [userProfile ? `USER.md:\n${userProfile}` : '', gbrainContext ? `Gbrain:\n${gbrainContext}` : '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 8000)
}

async function readUserProfile(): Promise<string> {
  try {
    return (await readFile(process.env.GBRAIN_USER_MD || defaultUserProfilePath, 'utf8')).slice(0, 6000)
  } catch {
    return ''
  }
}

async function queryGbrain(query: string): Promise<string> {
  const gbrainPath = process.env.GBRAIN_BIN || defaultGbrainPath
  try {
    const { stdout } = await execFileAsync(gbrainPath, ['query', query], {
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout.slice(0, 6000)
  } catch {
    return ''
  }
}
