/**
 * POST /api/notify — пуш від імені людини, що ввійшла.
 *
 *   { kind: 'test' }                                   собі, перевірити пристрій
 *   { kind: 'assigned', taskId, title, assigneeId }    партнерові: вам призначили
 *
 * Хто викликає — перевіряємо токеном сесії Supabase. Кому можна слати —
 * тільки учаснику ТОГО САМОГО дому: інакше будь-хто з акаунтом міг би
 * засипати пушами чужих людей.
 */
import { admin, json, once, release, sendTo } from './_lib.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return json(401, { error: 'Потрібен вхід' })

    const db = admin()
    const { data: auth, error: authError } = await db.auth.getUser(token)
    if (authError || !auth.user) return json(401, { error: 'Сесія недійсна' })
    const me = auth.user.id

    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    if (body.kind === 'test') {
      const sent = await sendTo([me], {
        title: 'Family Flow',
        body: 'Сповіщення працюють на цьому пристрої.',
        url: '/',
        tag: 'test',
      })
      return json(200, { sent })
    }

    if (body.kind === 'assigned') {
      const { taskId, title, assigneeId } = body
      if (typeof taskId !== 'string' || typeof title !== 'string' || typeof assigneeId !== 'string') {
        return json(400, { error: 'Неповний запит' })
      }
      if (assigneeId === me) return json(200, { sent: 0 })

      const { data: rows, error } = await db
        .from('household_members')
        .select('household_id, profile_id')
        .in('profile_id', [me, assigneeId])
      if (error) throw new Error(error.message)
      const mine = rows?.find(r => r.profile_id === me)?.household_id
      const theirs = rows?.find(r => r.profile_id === assigneeId)?.household_id
      if (!mine || mine !== theirs) return json(403, { error: 'Не з вашого дому' })

      // перепризначили туди-сюди — другий пуш тій самій людині вже не потрібен
      const key = `assigned:${taskId}:${assigneeId}`
      if (!await once(key)) return json(200, { sent: 0 })

      const { data: profile } = await db.from('profiles').select('display_name').eq('id', me).maybeSingle()
      const who = (profile?.display_name ?? '').trim()

      const sent = await sendTo([assigneeId], {
        title: 'Призначено вам',
        // безособово й без відмінювання імені — як у застосунку
        body: who ? `${title.slice(0, 120)} · ${who}` : title.slice(0, 120),
        url: '/#/tasks',
        tag: `task:${taskId}`,
      })
      if (sent === 0) await release(key)
      return json(200, { sent })
    }

    return json(400, { error: 'Невідомий тип' })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Помилка сервера' })
  }
}
