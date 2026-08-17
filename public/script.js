const socket = io();

let currentGroup = null;
let currentUser = null;
let typingTimer;


// ELEMENTS
const homeScreen = document.getElementById("homeScreen");
const chatScreen = document.getElementById("chatScreen");

const createTab = document.getElementById("createTab");
const joinTab = document.getElementById("joinTab");

const createForm = document.getElementById("createForm");
const joinForm = document.getElementById("joinForm");

const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");

const errorText = document.getElementById("errorText");

const messages = document.getElementById("messages");
const membersList = document.getElementById("membersList");

const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const typingIndicator =
    document.getElementById("typingIndicator");


// CREATE TAB
createTab.addEventListener("click", () => {

    createForm.classList.remove("hidden");
    joinForm.classList.add("hidden");

    createTab.classList.add("active");
    joinTab.classList.remove("active");

    errorText.textContent = "";
});


// JOIN TAB
joinTab.addEventListener("click", () => {

    createForm.classList.add("hidden");
    joinForm.classList.remove("hidden");

    joinTab.classList.add("active");
    createTab.classList.remove("active");

    errorText.textContent = "";
});


// CREATE GROUP
createBtn.addEventListener("click", async () => {

    const groupName =
        document.getElementById("groupName").value.trim();

    const adminName =
        document.getElementById("adminName").value.trim();

    if (!groupName || !adminName) {
        showError("Please enter group name and your name.");
        return;
    }

    try {

        const response = await fetch("/api/create-group", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                groupName,
                adminName
            })

        });

        const data = await response.json();

        if (!data.success) {
            showError(data.message);
            return;
        }

        currentGroup = data.group.code;
        currentUser = adminName;

        openChat(data.group);

    } catch (error) {

        showError("Server connection failed.");

    }

});


// JOIN GROUP
joinBtn.addEventListener("click", async () => {

    const code =
        document.getElementById("groupCode").value
            .trim()
            .toUpperCase();

    const memberName =
        document.getElementById("memberName").value.trim();

    if (!code || !memberName) {
        showError("Please enter group code and your name.");
        return;
    }

    try {

        const response = await fetch("/api/join-group", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                code,
                memberName
            })

        });

        const data = await response.json();

        if (!data.success) {
            showError(data.message);
            return;
        }

        currentGroup = code;
        currentUser = memberName;

        openChat(data.group);

    } catch (error) {

        showError("Server connection failed.");

    }

});


// OPEN CHAT
function openChat(group) {

    homeScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");

    document.getElementById("chatGroupName")
        .textContent = group.name;

    document.getElementById("chatGroupCode")
        .textContent = group.code;

    messages.innerHTML = "";

    socket.emit("joinRoom", {
        code: currentGroup,
        name: currentUser
    });

}


// GROUP DATA
socket.on("groupData", (group) => {

    document.getElementById("chatGroupName")
        .textContent = group.name;

    document.getElementById("chatGroupCode")
        .textContent = group.code;

    membersList.innerHTML = "";

    updateMembers(group.members);

    messages.innerHTML = "";

    group.messages.forEach(message => {
        displayMessage(message);
    });

    scrollMessages();

});


// MEMBERS UPDATE
socket.on("membersUpdate", (members) => {

    updateMembers(members);

});


// UPDATE MEMBERS
function updateMembers(members) {

    membersList.innerHTML = "";

    document.getElementById("memberCount")
        .textContent = `${members.length}/5`;

    members.forEach(member => {

        const div = document.createElement("div");

        div.className = "member";

        div.innerHTML = `
            <span class="status"></span>
            <span>${escapeHTML(member.name)}</span>
        `;

        membersList.appendChild(div);

    });

}


// SEND MESSAGE
function sendMessage() {

    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    socket.emit("sendMessage", {

        code: currentGroup,

        message: message

    });

    messageInput.value = "";

    socket.emit("stopTyping", {
        code: currentGroup
    });

    messageInput.focus();

}


// SEND BUTTON
sendBtn.addEventListener("click", sendMessage);


// ENTER TO SEND
messageInput.addEventListener("keydown", (event) => {

    if (event.key === "Enter") {

        event.preventDefault();

        sendMessage();

    }

});


// NEW MESSAGE
socket.on("newMessage", (message) => {

    displayMessage(message);

    scrollMessages();

});


// DISPLAY MESSAGE
function displayMessage(message) {

    const wrapper = document.createElement("div");

    const isMine =
        message.sender === currentUser;

    wrapper.className =
        isMine ? "message mine" : "message";

    wrapper.dataset.id = message.id;

    wrapper.innerHTML = `

        <div class="messageBubble">

            <div class="sender">
                ${escapeHTML(message.sender)}
            </div>

            <div class="messageText">
                ${escapeHTML(message.message)}
            </div>

            <div class="messageTime">
                ${message.time}
            </div>

        </div>

    `;

    // DELETE OWN MESSAGE
    if (isMine) {

        wrapper.addEventListener("contextmenu", (event) => {

            event.preventDefault();

            const confirmDelete =
                confirm("Delete this message?");

            if (confirmDelete) {

                socket.emit("deleteMessage", {

                    code: currentGroup,

                    messageId: message.id

                });

            }

        });

    }

    messages.appendChild(wrapper);

}


// DELETE MESSAGE
socket.on("messageDeleted", (messageId) => {

    const message =
        document.querySelector(
            `[data-id="${messageId}"]`
        );

    if (message) {
        message.remove();
    }

});


// SYSTEM MESSAGE
socket.on("systemMessage", (data) => {

    const div = document.createElement("div");

    div.className = "systemMessage";

    div.textContent =
        `${data.text} • ${data.time}`;

    messages.appendChild(div);

    scrollMessages();

});


// TYPING
messageInput.addEventListener("input", () => {

    socket.emit("typing", {
        code: currentGroup
    });

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {

        socket.emit("stopTyping", {
            code: currentGroup
        });

    }, 1000);

});


socket.on("userTyping", (name) => {

    typingIndicator.textContent =
        `${name} is typing...`;

});


socket.on("userStopTyping", () => {

    typingIndicator.textContent = "";

});


// ERROR
socket.on("errorMessage", (message) => {

    alert(message);

});


// SCROLL
function scrollMessages() {

    messages.scrollTop =
        messages.scrollHeight;

}


// ERROR DISPLAY
function showError(message) {

    errorText.textContent = message;

}


// SECURITY
function escapeHTML(text) {

    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;

}