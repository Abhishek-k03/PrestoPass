
//To prevent your Next.js app from opening 50 different walkie-talkie 
// connections every time a page refreshes, we create a single, clean socket instance file.

import {io} from "socket.io-client";

import { API_BASE_URL } from "./apiUrl";

//get backend url
const SOCKET_URL = API_BASE_URL;

//Connect to web socket server 
//autoConnect :false means we turn it on manually only when a user logs in!
export const socket = io(SOCKET_URL, {
    autoConnect: false,
    withCredentials: true,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
});