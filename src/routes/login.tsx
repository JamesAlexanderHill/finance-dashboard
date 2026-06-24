import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchAuthUser } from '~/lib/auth-guard'
import { LoginPage } from '~/features/core'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const user = await fetchAuthUser()
    if (user) throw redirect({ to: '/' })
  },
  component: LoginPage,
})
