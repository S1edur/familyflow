/**
 * GET /api/cron/daily — ранковий підсумок, запускає Vercel Cron (vercel.json).
 *
 * Кожній людині з увімкненими сповіщеннями — ОДИН пуш: платежі на сьогодні
 * й завтра та задачі на сьогодні. Один, а не по штуці на кожну справу:
 * десять пушів о девʼятій ранку — це причина вимкнути їх назавжди.
 *
 * Правила з CLAUDE.md, що діють і тут:
 *   - лише СВОЄ: призначене мені або нічиє. Про чуже прострочене не пишемо;
 *   - без сорому: «чекають», а не «прострочено».
 */
import { admin, json, kyivDate, money, once, plural, release, sendTo } from '../_lib.js'

interface Bill { name: string; recurring_plan_id: string | null; expected_amount_minor: number; currency: string; due_date: string }
interface Todo { title: string; defer_until: string | null }

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return json(401, { error: 'Лише для Vercel Cron' })
  }

  try {
    const db = admin()
    const today = kyivDate()
    const tomorrow = kyivDate(1)

    const { data: subs, error } = await db.from('push_subscriptions').select('profile_id')
    if (error) throw new Error(error.message)
    const people = [...new Set((subs ?? []).map(s => s.profile_id as string))]

    let sent = 0
    for (const p of people) {
      const { data: member } = await db
        .from('household_members').select('household_id').eq('profile_id', p).maybeSingle()
      if (!member) continue
      const hh = member.household_id as string

      const [{ data: bills }, { data: todos }, { data: incomePlans }] = await Promise.all([
        db.from('occurrences')
          .select('name, recurring_plan_id, expected_amount_minor, currency, due_date')
          .eq('household_id', hh).is('deleted_at', null)
          .in('status', ['due', 'projected'])
          .lte('due_date', tomorrow)
          .or(`assignee_id.eq.${p},assignee_id.is.null`)
          .order('due_date'),
        db.from('tasks')
          .select('title, defer_until')
          .eq('household_id', hh).is('deleted_at', null)
          .in('status', ['todo', 'doing'])
          .lte('due_date', today)
          .or(`assignee_id.eq.${p},assignee_id.is.null`)
          .order('due_date'),
        db.from('recurring_plans').select('id').eq('household_id', hh).eq('flow', 'in'),
      ]) as [{ data: Bill[] | null }, { data: Todo[] | null }, { data: { id: string }[] | null }]

      // очікувана зарплата — не справа, яку треба зробити
      const income = new Set((incomePlans ?? []).map(p => p.id))
      const b = (bills ?? []).filter(x => !x.recurring_plan_id || !income.has(x.recurring_plan_id))
      // відкладене до майбутньої дати людина свідомо прибрала з очей
      const t = (todos ?? []).filter(x => !x.defer_until || x.defer_until <= today)
      if (!b.length && !t.length) continue
      const key = `daily:${p}:${today}`
      if (!await once(key)) continue

      const parts: string[] = []
      if (b.length) parts.push(`${b.length} ${plural(b.length, 'платіж', 'платежі', 'платежів')}`)
      if (t.length) parts.push(`${t.length} ${plural(t.length, 'задача', 'задачі', 'задач')}`)

      const lines = [
        ...b.slice(0, 3).map(x => `${x.name} ${money(x.expected_amount_minor, x.currency)}`),
        ...t.slice(0, 3).map(x => x.title),
      ]
      const more = b.length + t.length - lines.length

      const n = await sendTo([p], {
        title: `Чекають: ${parts.join(' і ')}`,
        body: lines.join(' · ') + (more > 0 ? ` · ще ${more}` : ''),
        url: b.length ? '/#/bills' : '/#/tasks',
        tag: 'daily',
      })
      if (n === 0) await release(key)   // жоден пристрій не прийняв — не рахуємо надісланим
      sent += n
    }

    return json(200, { people: people.length, sent })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Помилка сервера' })
  }
}
