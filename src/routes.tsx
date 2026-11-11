import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { RedirectIfSignedIn, RequireAdmin, RequireAuth, RequirePasswordChange } from '@/auth/guards'
import { AppLayout } from '@/components/layout/AppLayout'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ProtocolsPage } from '@/pages/ProtocolsPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'
import { SetupPage } from '@/pages/SetupPage'

// Heavier screens load on demand (dnd-kit, evidence views, the report builder
// and, through it, the docx library), keeping the first load small.
const page = (load: () => Promise<Record<string, unknown>>, name: string) => async () => ({
  Component: (await load())[name] as ComponentType,
})

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <RedirectIfSignedIn />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'setup', element: <SetupPage /> },
        ],
      },
      {
        element: <RequirePasswordChange />,
        children: [{ path: 'change-password', element: <ChangePasswordPage /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, lazy: page(() => import('@/pages/DashboardPage'), 'DashboardPage') },
              { path: 'protocols', element: <ProtocolsPage /> },
              { path: 'protocols/:protocolId', lazy: page(() => import('@/pages/ProtocolDetailPage'), 'ProtocolDetailPage') },
              { path: 'protocols/:protocolId/runs/:runId', lazy: page(() => import('@/pages/TestRunPage'), 'TestRunPage') },
              { path: 'protocols/:protocolId/report', lazy: page(() => import('@/pages/ReportBuilderPage'), 'ReportBuilderPage') },
              { path: 'evidence', lazy: page(() => import('@/pages/EvidenceLibraryPage'), 'EvidenceLibraryPage') },
              { path: 'documents', lazy: page(() => import('@/pages/GeneratedDocumentsPage'), 'GeneratedDocumentsPage') },
              { path: 'audit', lazy: page(() => import('@/pages/AuditTrailPage'), 'AuditTrailPage') },
              { path: 'documents/:exportId', lazy: page(() => import('@/pages/ExportDetailPage'), 'ExportDetailPage') },
              {
                element: <RequireAdmin />,
                children: [
                  { path: 'users', lazy: page(() => import('@/pages/UsersPage'), 'UsersPage') },
                  { path: 'users/:userId', lazy: page(() => import('@/pages/UserDetailPage'), 'UserDetailPage') },
                ],
              },
              { path: 'settings', lazy: page(() => import('@/pages/SettingsPage'), 'SettingsPage') },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]
