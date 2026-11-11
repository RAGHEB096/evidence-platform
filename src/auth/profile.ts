export interface Profile {
  id: string
  username: string
  display_name: string
  is_admin: boolean
  can_create_protocols: boolean
  is_active: boolean
  must_change_password: boolean
}

export const PROFILE_COLUMNS = 'id, username, display_name, is_admin, can_create_protocols, is_active, must_change_password'
