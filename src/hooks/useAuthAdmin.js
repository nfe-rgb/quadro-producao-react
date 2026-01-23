// src/hooks/useAuthAdmin.js
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ADMIN_EMAILS } from '../lib/constants'

export default function useAuthAdmin(){
  const [authUser, setAuthUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      setAuthUser(data?.user ?? null)
      setAuthChecked(true)
    })()
    return () => { active = false }
  }, [])

  const isAdmin = useMemo(() => {
    const email = authUser?.email?.toLowerCase()
    return !!email && Array.isArray(ADMIN_EMAILS) && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
  }, [authUser])

  return { authUser, authChecked, isAdmin }
}
