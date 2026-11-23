import { defaultDeliveryChoice, deliveryChoiceValue, OTHER_DELIVERY, type StaffDeliveryChoice } from "@/lib/admin/carrier";
import { AdminField } from "./ui";
import styles from "./staff-delivery-fields.module.css";

export function StaffDeliveryFields({ choices, service, dispatch = false }: {
  choices: StaffDeliveryChoice[]; service: string | null; dispatch?: boolean;
}) {
  return <div className={`admin-grid ${styles.fields}`}>
    <AdminField label={dispatch ? "Carrier choice" : "Delivery service choice"}>
      <select name="deliveryChoice" defaultValue={defaultDeliveryChoice(choices, service, dispatch)}>
        {choices.filter(({ carrier }) => !dispatch || carrier).map((choice) => {
          const value = deliveryChoiceValue(choice);
          return <option key={value} value={value} data-manual-carrier={!choice.carrier || undefined}>
            {choice.carrier ? `${choice.carrier} · ${choice.service}` : `${choice.service} (enter carrier)`}
          </option>;
        })}
        <option value={OTHER_DELIVERY} data-manual-carrier>Other</option>
      </select>
    </AdminField>
    <div className={styles.manualCarrier}>
      <AdminField label="Carrier"><input name="carrier" maxLength={100} /></AdminField>
    </div>
    {!dispatch && <div className={styles.manualService}>
      <AdminField label="Carrier service"><input name="service" maxLength={100} /></AdminField>
    </div>}
  </div>;
}
