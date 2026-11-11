import type { RouteObject } from 'react-router'
import { RedirectIfSignedIn, RequireAdmin, RequireAuth, RequirePasswordChange } from '@/auth/guards'
import { AppLayout } from '@/components/layout/AppLayout'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { EvidenceLibraryPage } from '@/pages/EvidenceLibraryPage'
import { GeneratedDocumentsPage } from '@/pages/GeneratedDocumentsPage'
import { LoginPage } from '@/pages/LoginPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ProtocolDetailPage } from '@/pages/ProtocolDetailPage'
import { ProtocolsPage } from '@/pages/ProtocolsPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SetupPage } from '@/pages/SetupPage'
import { UserDetailPage } from '@/pages/UserDetailPage'
import { UsersPage } from '@/pages/UsersPage'

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
              { index: true, element: <DashboardPage /> },
              { path: 'protocols', element: <ProtocolsPage /> },
              { path: 'protocols/:protocolId', element: <ProtocolDetailPage /> },
              { path: 'evidence', element: <EvidenceLibraryPage /> },
              { path: 'documents', element: <GeneratedDocumentsPage /> },
              {
                element: <RequireAdmin />,
                children: [
                  { path: 'users', element: <UsersPage /> },
                  { path: 'users/:userId', element: <UserDetailPage /> },
                ],
              },
              { path: 'settings', element: <SettingsPage /> },
              { path: '*', element: <NotFoundPage /> },
            ],
          },
        ],
      },
    ],
  },
]
