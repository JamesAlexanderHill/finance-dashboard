import * as React from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
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

const updateWorkspace = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('No user found')
    try {
      await workspaceService.update(session.ctx, data)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

const createWorkspace = createServerFn({ method: 'POST' })
  .inputValidator((data: unknown) => data as { name: string })
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
      const user = await workspaceService.addMember(session.ctx, data.email)
      return { ok: true as const, member: { userId: user.id, name: user.name, email: user.email, role: 'member' as const, createdAt: new Date() } }
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
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

// ─── Loader ───────────────────────────────────────────────────────────────────

export const workspacesLoader = () => getWorkspacesData()

export type WorkspacesPageData = Awaited<ReturnType<typeof getWorkspacesData>>

// ─── Component ────────────────────────────────────────────────────────────────

type Member = { userId: string; name: string; email: string; role: 'owner' | 'member'; createdAt: Date }

export function WorkspacesPage({ user, currentWorkspaceId, workspaces, members: initialMembers }: WorkspacesPageData) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const [members, setMembers] = React.useState<Member[]>(() => initialMembers as Member[])

  const [editingSettings, setEditingSettings] = React.useState(false)
  const [settingsError, setSettingsError] = React.useState<string | null>(null)
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
  const isOwner = currentWorkspace?.role === 'owner'

  async function handleUpdateSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSettingsError(null)
    const fd = new FormData(e.currentTarget)
    const result = await updateWorkspace({ data: { name: String(fd.get('name')) } })
    if (!result.ok) {
      setSettingsError(result.message ?? 'Failed to update workspace')
      return
    }
    setEditingSettings(false)
    router.invalidate()
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    await createWorkspace({ data: { name: String(fd.get('name')) } })
    setShowCreate(false)
    await queryClient.invalidateQueries()
    router.invalidate()
  }

  async function handleSwitch(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) return
    await switchToWorkspace({ data: { workspaceId } })
    await queryClient.invalidateQueries()
    router.invalidate()
  }

  async function handleAddMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAddMemberError(null)
    const fd = new FormData(e.currentTarget)
    const result = await addMember({ data: { email: String(fd.get('email')) } })
    if (!result.ok) {
      setAddMemberError(result.message ?? 'Failed to add member')
      return
    }
    setMembers((prev) => [...prev, result.member])
    e.currentTarget.reset()
  }

  async function handleRemoveMember(userId: string) {
    setRemoveMemberError(null)
    const result = await removeMember({ data: { userId } })
    if (!result.ok) {
      setRemoveMemberError(result.message ?? 'Failed to remove member')
      return
    }
    setMembers((prev) => prev.filter((m) => m.userId !== userId))
  }

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Workspaces</h1>

      {currentWorkspace && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Current workspace</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl">
            {editingSettings ? (
              <form onSubmit={handleUpdateSettings} className="p-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                  <input
                    name="name"
                    required
                    defaultValue={currentWorkspace.name}
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {settingsError && <p className="text-xs text-red-600 dark:text-red-400">{settingsError}</p>}
                <div className="flex gap-2">
                  <button type="submit" className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md">Save</button>
                  <button type="button" onClick={() => { setEditingSettings(false); setSettingsError(null) }} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{currentWorkspace.name}</p>
                {isOwner && (
                  <button onClick={() => setEditingSettings(true)} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                    Edit
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-gray-800">
              <div className="px-4 py-2">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Members</p>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {members.map((member) => (
                  <div key={member.userId} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{member.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{member.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={['text-xs px-1.5 py-0.5 rounded', member.role === 'owner' ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'].join(' ')}>
                        {member.role}
                      </span>
                      {(isOwner || member.userId === user.id) && member.role !== 'owner' && (
                        <button onClick={() => handleRemoveMember(member.userId)} className="text-xs text-red-500 hover:text-red-700">
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {removeMemberError && <p className="text-xs text-red-600 dark:text-red-400 px-4 pb-3">{removeMemberError}</p>}
              {isOwner && (
                <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800">
                  <form onSubmit={handleAddMember} className="flex gap-2">
                    <input name="email" type="email" required placeholder="Add member by email" className="flex-1 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="submit" className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md whitespace-nowrap">Add member</button>
                  </form>
                  {addMemberError && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{addMemberError}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">All workspaces</h2>
          <button onClick={() => setShowCreate((v) => !v)} className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors">
            + New workspace
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input name="name" required placeholder="e.g., Household" className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</button>
            </div>
          </form>
        )}

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl divide-y divide-gray-100 dark:divide-gray-800">
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === currentWorkspaceId
            return (
              <div key={workspace.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{workspace.name}</span>
                  {workspace.role === 'owner' && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">Owner</span>
                  )}
                </div>
                {isCurrent ? (
                  <span className="text-xs px-2 py-1 rounded bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300">Current</span>
                ) : (
                  <button onClick={() => handleSwitch(workspace.id)} className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800">
                    Switch
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
