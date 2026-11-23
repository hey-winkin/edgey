"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { photoLimit } from "@/lib/requests/photo-limits";
import { photoAccept, prepareEnquiryPhoto } from "@/lib/requests/prepare-photo";
import styles from "./request.module.css";

export type PreparedPhoto = { url: string; blob: Blob; name: string };

export function EnquiryPhotos({ photos, onPhotos, onPreparing, disabled }: {
  photos: PreparedPhoto[];
  onPhotos: (photos: PreparedPhoto[]) => void;
  onPreparing: (preparing: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  const previews = useRef(new Set<string>());
  const mounted = useRef(false);
  const working = useRef(false);
  const add = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState("");
  const full = photos.length === photoLimit;

  useEffect(() => {
    mounted.current = true;
    const urls = previews.current;
    return () => {
      mounted.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || working.current || disabled) return;

    working.current = true;
    setPreparing(true);
    onPreparing(true);
    setNotice("");
    const selected = [...photos];
    const errors = new Set<string>();
    try {
      for (const file of files.slice(0, photoLimit - photos.length)) {
        try {
          const blob = await prepareEnquiryPhoto(file);
          if (!mounted.current) return;
          const url = URL.createObjectURL(blob);
          previews.current.add(url);
          selected.push({ url, blob, name: file.name });
        } catch (error) {
          errors.add(error instanceof Error ? error.message : "This photo couldn’t be prepared.");
        }
      }
      if (files.length > photoLimit - photos.length) errors.add("You can attach up to three photos.");
      if (mounted.current) {
        onPhotos(selected);
        setNotice([...errors].join(" "));
      }
    } finally {
      working.current = false;
      if (mounted.current) {
        setPreparing(false);
        onPreparing(false);
      }
    }
  }

  return (
    <fieldset className={styles.photos} aria-describedby={`${id}-help`}>
      <legend>Photos (optional)</legend>
      <p className="muted" id={`${id}-help`}>We use these photos to help identify your blade. Add up to three photos of the blade, packet label or tool holder.</p>
      <div className={styles.photoActions}>
        <label className={styles.photoPicker}>
          <input ref={add} type="file" accept={photoAccept} multiple disabled={disabled || preparing || full} onChange={choose} />
          <span>Add photos</span>
        </label>
        <label className={`${styles.photoPicker} ${styles.photoCamera}`}>
          <input type="file" accept="image/*" capture="environment" disabled={disabled || preparing || full} onChange={choose} />
          <span>Take photo</span>
        </label>
      </div>
      {photos.length > 0 && (
        <ul className={styles.photoList} aria-label="Photos to attach">
          {photos.map(({ url, name }, index) => (
            <li key={url}>
              <Image unoptimized src={url} width={88} height={66} alt="" />
              <button type="button" disabled={disabled || preparing} aria-label={`Remove photo ${index + 1}: ${name}`} onClick={() => {
                onPhotos(photos.filter((photo) => photo.url !== url));
                URL.revokeObjectURL(url);
                previews.current.delete(url);
                setNotice("");
                requestAnimationFrame(() => add.current?.focus());
              }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className={notice ? styles.fieldError : "muted"}>
        {preparing ? "Preparing photos…" : notice || (photos.length > 0 ? `${photos.length} of ${photoLimit} photos ready` : "")}
      </p>
    </fieldset>
  );
}
