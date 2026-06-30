export type SmsPurpose = 'register' | 'login'

type SendVerificationSmsArgs = {
  phone: string
  code: string
  purpose: SmsPurpose
}

function isDevOrTest() {
  return process.env.NODE_ENV !== 'production'
}

function getSmsProvider() {
  return process.env.SMS_PROVIDER?.trim().toLowerCase() || ''
}

async function sendByConsole(args: SendVerificationSmsArgs) {
  console.log(`[SMS:${args.purpose}] phone=${args.phone} code=${args.code}`)
}

export async function sendVerificationSms(args: SendVerificationSmsArgs) {
  const provider = getSmsProvider()

  if (!provider) {
    if (isDevOrTest()) {
      await sendByConsole(args)
      return
    }
    throw new Error('未配置短信服务提供商，生产环境不能发送验证码')
  }

  if (provider === 'console') {
    await sendByConsole(args)
    return
  }

  throw new Error(`不支持的短信服务提供商: ${provider}`)
}
