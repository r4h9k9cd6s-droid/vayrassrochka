export const INVITE_TEXT = (url: string) =>
  `Пользуюсь ВайРассрочкой: там видно, где и на каких условиях покупают в рассрочку, и есть счётчик платежей и котла. Бесплатно, нужен только логин. ${url}`;

/** Системное «Поделиться»; если его нет — копирует текст. Возвращает сообщение для пользователя. */
export async function shareInvite(): Promise<string> {
  const text = INVITE_TEXT(location.origin);
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return '';
    }
    await navigator.clipboard.writeText(text);
    return 'Текст скопирован: отправьте его знакомым';
  } catch {
    return '';
  }
}
