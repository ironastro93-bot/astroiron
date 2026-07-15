importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({apiKey:"AIzaSyD1sOh487RQRmvxOVA6PX2B_JhExbhDMn0",authDomain:"astroiron-46437.firebaseapp.com",projectId:"astroiron-46437",messagingSenderId:"1053533695091",appId:"1:1053533695091:web:5d69e522e720ce10c1ce06"});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(function(payload){
  var n=payload.notification||{};
  self.registration.showNotification(n.title||"ASTRO IRON",{body:n.body||"",icon:"/icon-192.png",badge:"/icon-192.png",data:payload.data||{}});
});
self.addEventListener("notificationclick",function(e){e.notification.close();var url=(e.notification.data&&e.notification.data.url)||"https://astroiron.com/";e.waitUntil(clients.openWindow(url))});
