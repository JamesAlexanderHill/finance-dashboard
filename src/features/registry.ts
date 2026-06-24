import type React from 'react'

export interface NavLink {
  label: string
  to: string
  exact?: boolean
}

export interface DashboardWidget {
  id: string
  title: string
  component: React.ComponentType
  size?: 'sm' | 'md' | 'lg'
}

export interface ServerPlugin {
  // TanStack Start middleware contributed by this feature (for future use)
  middleware?: unknown[]
}

export interface ClientPlugin {
  navLinks?: NavLink[]
  // React providers to wrap the app with (outermost first)
  providers?: React.ComponentType<{ children: React.ReactNode }>[]
  dashboardWidgets?: DashboardWidget[]
}

export interface FeaturePlugin {
  id: string
  server?: ServerPlugin
  client?: ClientPlugin
}

class PluginRegistry {
  private plugins = new Map<string, FeaturePlugin>()

  register(plugin: FeaturePlugin) {
    this.plugins.set(plugin.id, plugin)
  }

  getNavLinks(): NavLink[] {
    return [...this.plugins.values()].flatMap((p) => p.client?.navLinks ?? [])
  }

  getProviders(): React.ComponentType<{ children: React.ReactNode }>[] {
    return [...this.plugins.values()].flatMap((p) => p.client?.providers ?? [])
  }

  getDashboardWidgets(): DashboardWidget[] {
    return [...this.plugins.values()].flatMap((p) => p.client?.dashboardWidgets ?? [])
  }
}

export const registry = new PluginRegistry()
