"use client";

import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { initialRequestFormState, requestTrapField, type RequestFormState } from "@/lib/requests/forms";
import { EnquiryPhotos, type PreparedPhoto } from "./enquiry-photos";
import styles from "./request.module.css";

const subscribe = () => () => {};

export type RequestField = {
  name: string;
  label: string;
  initialValue?: string;
  required?: boolean;
  help?: string;
  maxLength?: number;
  autoComplete?: string;
} & (
  | { type?: "text" | "email" | "textarea" }
  | { type: "select"; options: readonly (readonly [string, string])[] }
);

export function RequestForm({
  action,
  fields,
  attemptId,
  submitLabel,
  successTitle,
  successMessage,
  uploadPhotos,
  keepFormOnSuccess = false,
}: {
  action: (previous: RequestFormState, data: FormData) => Promise<RequestFormState>;
  fields: RequestField[];
  attemptId?: string;
  submitLabel: string;
  successTitle: string;
  successMessage: string;
  uploadPhotos?: (token: string, data: FormData) => Promise<number>;
  keepFormOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialRequestFormState);
  const [attempt] = useState(attemptId);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [photoResult, setPhotoResult] = useState<{ token: string; count: number | null }>();
  const startedUpload = useRef<string>(null);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const hasError = state.status === "error";
  const token = state.photoUploadToken;
  const uploading = Boolean(token && photoResult?.token !== token);
  const succeeded = state.status === "success";
  const invalidFields = fields.filter((field) => state.errors?.[field.name]);

  useEffect(() => {
    if (!token || !uploadPhotos || startedUpload.current === token) return;
    startedUpload.current = token;
    const attachments = new FormData();
    for (const { blob } of photos) attachments.append("photo", blob, "photo.jpg");
    const finish = (count: number | null) =>
      setPhotoResult((previous) => previous?.token === token ? previous : { token, count });
    const timeout = window.setTimeout(() => finish(null), 75_000);
    void uploadPhotos(token, attachments).then(finish, () => finish(null)).finally(() => window.clearTimeout(timeout));
  }, [photos, token, uploadPhotos]);

  useEffect(() => {
    if (state.status !== "idle") heading.current?.focus();
  }, [state]);

  return (
    <>
      {hasError && (
        <div className={styles.notice}>
          <h2 tabIndex={-1} ref={heading}>
            {invalidFields.length ? "Check the form" : "We couldn’t send the form"}
          </h2>
          {state.message && <p>{state.message}</p>}
          {!state.message && !invalidFields.length && <p>Please try again.</p>}
          {invalidFields.length > 0 && (
            <ul>
              {invalidFields.map((field) => (
                <li key={field.name}>
                  <a href={`#${id}-${field.name}`} className="textlink">
                    {state.errors?.[field.name]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div role="status" aria-atomic="true">
        {succeeded && (
          <div className={styles.notice}>
            <h2 tabIndex={-1} ref={heading}>{successTitle}</h2>
            <p>{state.message ?? successMessage}</p>
            {uploading ? (
              <p>Uploading photos. Keep this page open.</p>
            ) : uploadPhotos && photos.length > 0 && (
              <>
                {!!photoResult?.count && <p>{photoResult.count} {photoResult.count === 1 ? "photo attached." : "photos attached."}</p>}
                {(photoResult?.count ?? 0) < photos.length && (
                  <p>
                    {photoResult?.count === null ? "We couldn’t confirm your photo upload."
                      : photoResult?.count ? "Some photos couldn’t be attached." : "We couldn’t attach your photos."}
                    {" "}You can send photos in reply when we email you.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {(!succeeded || keepFormOnSuccess) && (
        <form action={formAction} onSubmit={(event) => {
          if (preparing || pending) event.preventDefault();
        }} onReset={(event) => event.preventDefault()} noValidate className={styles.form}>
          {attempt && <input type="hidden" name="attemptId" value={attempt} />}
          <input name={requestTrapField} type="text" className={styles.trap} aria-hidden="true" tabIndex={-1} autoComplete="off" />
          {fields.map((field) => {
            const fieldId = `${id}-${field.name}`;
            const error = hasError ? state.errors?.[field.name] : undefined;
            const description = [
              field.help ? `${fieldId}-help` : null,
              error ? `${fieldId}-error` : null,
            ].filter(Boolean).join(" ");
            const inputProps = {
              id: fieldId,
              name: field.name,
              required: field.required,
              defaultValue: field.initialValue ?? "",
              "aria-describedby": description || undefined,
              "aria-invalid": error ? true : undefined,
            };

            return (
              <div key={field.name} className={styles.field}>
                <label htmlFor={fieldId}>{field.label}</label>
                {field.help && <p className="muted" id={`${fieldId}-help`}>{field.help}</p>}
                {field.type === "select" ? (
                  <div className="select-field">
                    <select {...inputProps}>
                      <option value="">{field.required ? "Choose an option" : "Not specified"}</option>
                      {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                ) : field.type === "textarea" ? (
                  <textarea {...inputProps} rows={4} maxLength={field.maxLength} className={styles.control} />
                ) : (
                  <input
                    {...inputProps}
                    type={field.type ?? "text"}
                    maxLength={field.maxLength}
                    autoComplete={field.autoComplete}
                    className={styles.control}
                  />
                )}
                {error && <p id={`${fieldId}-error`} className={styles.fieldError}>{error}</p>}
              </div>
            );
          })}
          {uploadPhotos && hydrated && (
            <>
              <EnquiryPhotos photos={photos} onPhotos={setPhotos} onPreparing={setPreparing} disabled={pending} />
              <input type="hidden" name="photoCount" value={photos.length} />
            </>
          )}
          <button className={`primary ${styles.submit}`} type="submit" disabled={pending || preparing}>
            {pending ? "Sending…" : submitLabel}
          </button>
        </form>
      )}
    </>
  );
}
