import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { workspaceService, getSession, setCurrentWorkspaceId } from '~/db/services'

// ─── Server functions ─────────────────────────────────────────────────────────

const getWorkspacesData = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return { user: null, currentWorkspaceId: null, workspaces: [], members: [] }

  const [workspaces, members] = await Promise.all([
    workspaceService.list(session.ctx),
    workspaceService.listMembers(session.ctx),
  ])

  return {
    user: session.user,
    currentWorkspaceId: session.workspace.id,
    workspaces,
    members,
  }
})

const createWorkspace = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string; homeCurrencyCode: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    const workspace = await workspaceService.create(session.ctx, data)
    setCurrentWorkspaceId(workspace.id)
  })

const switchToWorkspace = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { workspaceId: string })
  .handler(async ({ data }) => {
    setCurrentWorkspaceId(data.workspaceId)
  })

const addMember = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { email: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    try {
      await workspaceService.addMember(session.ctx, data.email)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

const removeMember = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { userId: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    try {
      await workspaceService.removeMember(session.ctx, data.userId)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/workspaces')({
  loader: () => getWorkspacesData(),
  component: WorkspacesPage,
})

// ─── Component ────────────────────────────────────────────────────────────────

function WorkspacesPage() {
  const { user, currentWorkspaceId, workspaces, members } = Route.useLoaderData()
  const router = useRouter()
  const [showCreate, setShowCreate] = React.useState(false)
  const [addMemberError, setAddMemberError] = React.useState<string | null>(null)
  const [removeMemberError, setRemoveMemberError] = React.useState<string | null>(null)

  if (!user) {
    return (
      <div className="text-gray-500 dark:text-gray-400 text-sm">
        No user found. Visit{' '}
        <a href="/dev" className="text-blue-600 dark:text-blue-400 underline">
          Dev Tools
        </a>{' '}
        to seed data.
      </div>
    )
  }

  const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)
  const currentRole = currentWorkspace?.role
  const isOwner = currentRole === 'owner'

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createWorkspace({
      data: {
        name: String(fd.get('name')),
        homeCurrencyCode: String(fd.get('homeCurrencyCode')),
      },
    })
    setShowCreate(false)
    router.invalidate()
  }

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) return
    await switchToWorkspace({ data: { workspaceId } })
    router.invalidate()
  }

  async function handleAddMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAddMemberError(null)
    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email'))
    const result = await addMember({ data: { email } })
    if (!result.ok) {
      setAddMemberError(result.message ?? 'Failed to add member')
      return
    }
    e.currentTarget.reset()
    router.invalidate()
  }

  async function handleRemoveMember(userId: string) {
    setRemoveMemberError(null)
    const result = await removeMember({ data: { userId } })
    if (!result.ok) {
      setRemoveMemberError(result.message ?? 'Failed to remove member')
      return
    }
    router.invalidate()
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Workspaces list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Workspaces</h1>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
          >
            + New Workspace
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                <input
                  name="name"
                  required
                  placeholder="e.g., Household"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Home currency</label>
                <input
                  name="homeCurrencyCode"
                  required
                  defaultValue="AUD"
                  maxLength={3}
                  placeholder="AUD"
                  className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === currentWorkspaceId
            return (
              <div key={workspace.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{workspace.name}</span>
                    {workspace.isPersonal && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        Personal
                      </span>
                    )}
                    {workspace.role === 'owner' && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                        Owner
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{workspace.homeCurrencyCode}</p>
                </div>
                {isCurrent ? (
                  <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300">
                    Current
                  </span>
                ) : (
                  <button
                    onClick={() => handleSwitch(workspace.id)}
                    className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Switch
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Members of the current workspace */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Members — {currentWorkspace?.name}
        </h2>

        {currentWorkspace?.isPersonal ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Personal workspaces can't have members. Create a shared workspace to invite others.
          </p>
        ) : (
          <>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800 mb-3">
              {members.map((member) => (
                <div key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'text-xs px-1.5 py-0.5 rounded',
                        member.role === 'owner'
                          ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
                      ].join(' ')}
                    >
                      {member.role}
                    </span>
                    {(isOwner || member.userId === user.id) && member.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(member.userId)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {removeMemberError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-3">{removeMemberError}</p>
            )}

            {isOwner && (
              <form onSubmit={handleAddMember} className="flex gap-2">
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="Add member by email"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md whitespace-nowrap"
                >
                  Add member
                </button>
              </form>
            )}
            {addMemberError && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-2">{addMemberError}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
