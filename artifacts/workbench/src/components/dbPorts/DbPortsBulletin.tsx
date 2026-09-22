import type { DbPortsExportPayload } from "@workspace/api-client-react";
import { buildDbPortsDocument } from "@/lib/dbPortsExport";

export type DbPortsBulletinProps = {
  payload: DbPortsExportPayload;
};

/** Read-only bulletin proof. Content and ordering come from the export model. */
export function DbPortsBulletin({ payload }: DbPortsBulletinProps) {
  const report = buildDbPortsDocument(payload);

  return (
    <article className="mx-auto max-w-4xl bg-white px-6 py-8 text-[#363636] sm:px-10">
      <header className="border-b-2 border-[#465bff] pb-6">
        <p className="text-xs font-bold tracking-wide text-red-800">{report.notice}</p>
        <h1 className="mt-3 text-3xl font-bold text-[#0b0a3d]">{report.title}</h1>
        <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-[#0b0a3d]">
          {report.kicker}
        </p>
        <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {report.metadata.map((line) => (
            <div key={line.label} className="flex gap-2">
              <dt className="font-semibold">{line.label}:</dt>
              <dd>{line.text}</dd>
            </div>
          ))}
        </dl>
      </header>

      {report.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="border-b border-[#465bff] pb-2 text-lg font-bold uppercase text-[#0b0a3d]">
            {section.heading}
          </h2>
          {section.introduction ? (
            <p className="mt-4 whitespace-pre-line text-sm leading-6">{section.introduction}</p>
          ) : null}
          {section.entries.map((entry, index) => (
            <div key={`${entry.heading}-${index}`} className="mt-6">
              <h3 className="text-base font-bold text-[#0b0a3d]">{entry.heading}</h3>
              <dl className="mt-3 space-y-2 text-sm leading-6">
                {entry.lines.map((line, lineIndex) => (
                  <div key={`${line.label ?? "line"}-${lineIndex}`}>
                    {line.label ? <dt className="inline font-semibold">{line.label}: </dt> : null}
                    <dd className="inline">
                      {line.url ? (
                        <a
                          className="break-words text-[#3149d8] underline"
                          href={line.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {line.text}
                        </a>
                      ) : (
                        line.text
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </section>
      ))}

      <section className="mt-8 border-t border-[#e2e2e2] pt-5">
        <h2 className="text-sm font-bold uppercase text-[#0b0a3d]">Disclaimer</h2>
        <p className="mt-2 text-[9pt] italic leading-snug">{report.disclaimer}</p>
      </section>
    </article>
  );
}

export default DbPortsBulletin;