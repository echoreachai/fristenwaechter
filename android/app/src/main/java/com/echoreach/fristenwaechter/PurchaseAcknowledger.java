package com.echoreach.fristenwaechter;

import android.app.Activity;
import android.content.Context;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryPurchasesParams;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Bestätigt ("acknowledge") Abo-Käufe direkt auf dem Gerät.
 *
 * Google erstattet Käufe automatisch, wenn sie nicht innerhalb von 3 Tagen
 * bestätigt werden. Die Web-App (Digital Goods API 2.0) kann das nicht mehr
 * selbst, und Fristen-Wächter hat bewusst keinen eigenen Server. Deshalb
 * erledigt das die Android-Hülle über die offizielle Play-Billing-Bibliothek:
 *  - bei jedem App-Start
 *  - direkt nachdem das Google-Play-Kauffenster (PaymentActivity) geschlossen wurde
 */
public final class PurchaseAcknowledger {
    private static final String TAG = "FW-Acknowledger";
    private static final String PAYMENT_ACTIVITY =
            "com.google.androidbrowserhelper.playbilling.provider.PaymentActivity";
    private static boolean sRunning = false;

    private PurchaseAcknowledger() {}

    public static void register(final android.app.Application app) {
        run(app);
        app.registerActivityLifecycleCallbacks(new android.app.Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityCreated(Activity activity, Bundle savedInstanceState) {}
            @Override public void onActivityStarted(Activity activity) {}
            @Override public void onActivityResumed(Activity activity) {}
            @Override public void onActivityPaused(Activity activity) {}
            @Override public void onActivityStopped(Activity activity) {}
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle outState) {}
            @Override public void onActivityDestroyed(Activity activity) {
                if (PAYMENT_ACTIVITY.equals(activity.getClass().getName())) {
                    // kurz warten, bis Google Play den Kauf gespeichert hat
                    new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                        @Override public void run() { PurchaseAcknowledger.run(app); }
                    }, 2000);
                }
            }
        });
    }

    public static synchronized void run(Context context) {
        if (sRunning) return;
        sRunning = true;
        final BillingClient client;
        try {
            client = BillingClient.newBuilder(context.getApplicationContext())
                    .setListener((billingResult, purchases) -> { /* Käufe laufen über PaymentActivity */ })
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder()
                            .enableOneTimeProducts()
                            .build())
                    .build();
        } catch (RuntimeException e) {
            Log.w(TAG, "BillingClient konnte nicht erstellt werden", e);
            sRunning = false;
            return;
        }
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "Billing nicht verfügbar: " + result.getDebugMessage());
                    finish(client);
                    return;
                }
                QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build();
                client.queryPurchasesAsync(params, (queryResult, purchases) -> {
                    if (queryResult.getResponseCode() != BillingClient.BillingResponseCode.OK
                            || purchases == null) {
                        finish(client);
                        return;
                    }
                    acknowledgeAll(client, purchases);
                });
            }

            @Override
            public void onBillingServiceDisconnected() {
                synchronized (PurchaseAcknowledger.class) { sRunning = false; }
            }
        });
    }

    private static void acknowledgeAll(final BillingClient client, List<Purchase> purchases) {
        List<Purchase> open = new ArrayList<>();
        for (Purchase p : purchases) {
            if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED && !p.isAcknowledged()) {
                open.add(p);
            }
        }
        if (open.isEmpty()) {
            finish(client);
            return;
        }
        final AtomicInteger remaining = new AtomicInteger(open.size());
        for (Purchase p : open) {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(p.getPurchaseToken())
                    .build();
            client.acknowledgePurchase(params, ackResult -> {
                Log.i(TAG, "Bestätigung: " + ackResult.getResponseCode());
                if (remaining.decrementAndGet() == 0) finish(client);
            });
        }
    }

    private static void finish(BillingClient client) {
        try {
            client.endConnection();
        } catch (RuntimeException ignored) {
            // nichts zu tun
        }
        synchronized (PurchaseAcknowledger.class) { sRunning = false; }
    }
}
