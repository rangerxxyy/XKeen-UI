export function bindDnsTextareaGrowth(textareas: readonly HTMLTextAreaElement[]): void {
  for (const textarea of textareas) {
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    textarea.addEventListener('input', resize);
  }
}
