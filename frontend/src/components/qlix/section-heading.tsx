interface SectionHeadingProps {
  readonly title: string;
  readonly description?: string;
}

export function SectionHeading({ title, description }: SectionHeadingProps) {
  return (
    <div>
      <h2 className="text-[11px] font-medium uppercase tracking-widest text-[--text-tertiary]">
        {title}
      </h2>
      {description ? (
        <p className="mt-1 text-[13px] text-[--text-secondary]">{description}</p>
      ) : null}
    </div>
  );
}
