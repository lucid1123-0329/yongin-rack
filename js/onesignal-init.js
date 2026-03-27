window.OneSignalDeferred = window.OneSignalDeferred || [];
OneSignalDeferred.push(async function(OneSignal) {
  await OneSignal.init({
    appId: "7961c022-a9a3-4894-8133-0ed0ae87a2e3",
    safari_web_id: "web.onesignal.auto.2d34c372-40ef-4eb5-956b-2d525ea9497b",
    serviceWorkerParam: { scope: '/' },
    serviceWorkerPath: 'sw.js'
  });
});
