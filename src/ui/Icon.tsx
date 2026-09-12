/* Іконки — один стиль, один розмір за замовчуванням. Нових бібліотек не додаємо. */
const S = (p: { d: string; size?: number; fill?: boolean }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24"
       fill={p.fill ? 'currentColor' : 'none'} stroke="currentColor"
       strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={p.d} />
  </svg>
)
export const Icon = {
  home:  (s?: number) => <S size={s} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  check: (s?: number) => <S size={s} d="M4 12.5 9 17.5 20 6.5" />,
  list:  (s?: number) => <S size={s} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  wallet:(s?: number) => <S size={s} d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v1.5M3 7.5V18a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-3M3 7.5h17a1 1 0 0 1 1 1V15m0 0h-4a1.5 1.5 0 0 1 0-3h4" />,
  cart:  (s?: number) => <S size={s} d="M3 4h2l2.2 10.4a1 1 0 0 0 1 .8h8.3a1 1 0 0 0 1-.75L19.5 8H6M9 20h.01M17 20h.01" />,
  piggy: (s?: number) => <S size={s} d="M4 12a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2a3 3 0 0 1-3 3v2h-3v-2H10v2H7v-2a3 3 0 0 1-3-3zM2 11v2M15 10h.01" />,
  plus:  (s?: number) => <S size={s} d="M12 5v14M5 12h14" />,
  x:     (s?: number) => <S size={s} d="M6 6l12 12M18 6L6 18" />,
  chev:  (s?: number) => <S size={s} d="M9 6l6 6-6 6" />,
  more:  (s?: number) => <S size={s} d="M5 12h.01M12 12h.01M19 12h.01" />,
  sun:   (s?: number) => <S size={s} d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />,
  moon:  (s?: number) => <S size={s} d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  image: (s?: number) => <S size={s} d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-4 4 3 3-2 6 5M9 9.5h.01" />,
  gear:  (s?: number) => <S size={s} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-3-1.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.3-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 3 1.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1.2z" />,
  pin:   (s?: number) => <S size={s} d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />,
  clock: (s?: number) => <S size={s} d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2" />,
  trash: (s?: number) => <S size={s} d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" />,
  pencil:(s?: number) => <S size={s} d="M4 20h4L20 8a2 2 0 0 0-3-3L5 17zM15 6l3 3" />,
}
