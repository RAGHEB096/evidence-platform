import type { RouteObject } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { DashboardPage } from '@/pages/DashboardPage'
import { EvidenceLibraryPage } from '@/pages/EvidenceLibraryPage'
import { GeneratedDocumentsPage } from '@/pages/GeneratedDocumentsPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { ProtocolsPage } from '@/pages/ProtocolsPage'
import { RouteErrorPage } from '@/pages/RouteErrorPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { UsersPage } from '@/pages/UsersPage'

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'protocols', element: <ProtocolsPage /> },
      { path: 'evidence', element: <EvidenceLibraryPage /> },
      { path: 'documents', element: <GeneratedDocumentsPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
