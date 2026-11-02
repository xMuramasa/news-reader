/** The Endfield title rule: three equal bars (magenta, yellow, green), 4 px tall, 192 px wide. */
export function TitleRule() {
  return (
    <div aria-hidden className="flex h-1 w-48 max-w-full">
      <span className="flex-1 bg-[#FF1AAC]" />
      <span className="flex-1 bg-[#FFFA00]" />
      <span className="flex-1 bg-[#00FFA2]" />
    </div>
  );
}
