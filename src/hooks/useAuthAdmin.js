// src/hooks/useAuthAdmin.js
import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabaseClient'
import { ADMIN_EMAILS, ACCESS_LEVEL_1_EMAILS, ACCESS_LEVEL_2_EMAILS, ACCESS_LEVEL_MENDES_EMAILS } from '../lib/constants'

export default function useAuthAdmin(){
  const [authUser, setAuthUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    let active = true
    let authSubscription = null
    ;(async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      setAuthUser(data?.user ?? null)
      setAuthChecked(true)
    })()

    const { data: listenerData } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setAuthUser(session?.user ?? null)
      setAuthChecked(true)
    })
    authSubscription = listenerData?.subscription ?? null

    return () => {
      active = false
      try {
        authSubscription?.unsubscribe?.()
      } catch {
        // noop
      }
    }
  }, [])

  const isAdmin = useMemo(() => {
    const email = authUser?.email?.toLowerCase()
    return !!email && Array.isArray(ADMIN_EMAILS) && ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
  }, [authUser])

  const accessLevel = useMemo(() => {
    const email = authUser?.email?.toLowerCase()
    if (!email) return 0
    if (isAdmin) return 2
    if (Array.isArray(ACCESS_LEVEL_2_EMAILS) && ACCESS_LEVEL_2_EMAILS.map(e => e.toLowerCase()).includes(email)) return 2
    if (Array.isArray(ACCESS_LEVEL_1_EMAILS) && ACCESS_LEVEL_1_EMAILS.map(e => e.toLowerCase()).includes(email)) return 1
    return 0
  }, [authUser, isAdmin])

  const isMendes = useMemo(() => {
    const email = authUser?.email?.toLowerCase()
    if (!email) return false
    if (Array.isArray(ACCESS_LEVEL_MENDES_EMAILS) && ACCESS_LEVEL_MENDES_EMAILS.map(e => e.toLowerCase()).includes(email)) {
      return true
    }
    return false
  }, [authUser])

  return { authUser, authChecked, isAdmin, accessLevel, isMendes }
}
