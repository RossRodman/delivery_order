import { Suspense } from "react";
import { OrderScreen } from "./OrderScreen";

export default function OrderPage() {
  return (
    <Suspense>
      <OrderScreen />
    </Suspense>
  );
}
