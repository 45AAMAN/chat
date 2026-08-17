const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.get("/",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","index.html"));
});

const groups=new Map();
const FIXED_GROUP_CODE="NE2026ET2025";

function getTime(){
    return new Date().toLocaleTimeString("en-IN",{
        timeZone:"Asia/Kolkata",
        hour:"2-digit",
        minute:"2-digit",
        hour12:true
    });
}

function getNow(){
    return Date.now();
}

// CREATE GROUP
app.post("/api/create-group",(req,res)=>{
    const {groupName,adminName}=req.body;

    if(!groupName||!adminName){
        return res.status(400).json({
            success:false,
            message:"Group name and admin name are required."
        });
    }

    let group=groups.get(FIXED_GROUP_CODE);

    if(!group){
        group={
            name:groupName.trim(),
            code:FIXED_GROUP_CODE,
            admin:adminName.trim(),
            members:[],
            history:[],
            memberHistory:new Map()
        };

        groups.set(FIXED_GROUP_CODE,group);
    }

    res.json({
        success:true,
        group:{
            name:group.name,
            code:group.code,
            admin:group.admin
        }
    });
});

// JOIN GROUP
app.post("/api/join-group",(req,res)=>{
    const {code,memberName}=req.body;

    if(!code||!memberName){
        return res.status(400).json({
            success:false,
            message:"Group code and your name are required."
        });
    }

    const groupCode=code.trim().toUpperCase();

    if(groupCode!==FIXED_GROUP_CODE){
        return res.status(404).json({
            success:false,
            message:"Invalid group code."
        });
    }

    const group=groups.get(groupCode);

    if(!group){
        return res.status(404).json({
            success:false,
            message:"Group does not exist. Admin must create the group first."
        });
    }

    const onlineMembers=group.members.filter(
        member=>member.online
    );

    if(onlineMembers.length>=5){
        return res.status(400).json({
            success:false,
            message:"Group is full. Maximum 5 members allowed."
        });
    }

    res.json({
        success:true,
        group:{
            name:group.name,
            code:group.code,
            admin:group.admin
        }
    });
});

// SOCKET
io.on("connection",(socket)=>{

    console.log("User connected:",socket.id);

    // JOIN ROOM
    socket.on("joinRoom",({code,name,memberId})=>{

        const groupCode=(code||"").trim().toUpperCase();

        if(groupCode!==FIXED_GROUP_CODE){
            socket.emit("errorMessage","Invalid group code.");
            return;
        }

        const group=groups.get(groupCode);

        if(!group){
            socket.emit("errorMessage","Group does not exist.");
            return;
        }

        if(!memberId){
            socket.emit(
                "errorMessage",
                "Member ID missing. Please refresh the page."
            );
            return;
        }

        const onlineMembers=group.members.filter(
            member=>member.online
        );

        if(onlineMembers.length>=5){
            socket.emit(
                "errorMessage",
                "Group is full. Maximum 5 members allowed."
            );
            return;
        }

        // MEMBER HISTORY RECORD
        let memberRecord=group.memberHistory.get(memberId);

        if(!memberRecord){

            // First time ever joining:
            // Show all messages from the beginning.
            memberRecord={
                firstJoin:true,
                resetAfter:0
            };

            group.memberHistory.set(
                memberId,
                memberRecord
            );
        }

        // If same member reconnects after leaving,
        // only messages after resetAfter are shown.
        const visibleMessages=group.history.filter(
            message=>message.timestamp>memberRecord.resetAfter
        );

        // Add active member
        group.members.push({
            name:name.trim(),
            memberId:memberId,
            socketId:socket.id,
            online:true
        });

        socket.join(groupCode);

        socket.groupCode=groupCode;
        socket.userName=name.trim();
        socket.memberId=memberId;

        // SEND GROUP DATA
        socket.emit("groupData",{
            name:group.name,
            code:group.code,
            admin:group.admin,

            members:group.members
                .filter(member=>member.online)
                .map(member=>({
                    name:member.name,
                    online:true
                })),

            messages:visibleMessages
        });

        // Join notification to others
        socket.to(groupCode).emit(
            "systemMessage",
            {
                text:`${name} joined the group`,
                time:getTime()
            }
        );

        // Update members
        io.to(groupCode).emit(
            "membersUpdate",
            group.members
                .filter(member=>member.online)
                .map(member=>({
                    name:member.name,
                    online:true
                }))
        );

        console.log(
            `${name} joined room ${groupCode}`
        );
    });

    // SEND MESSAGE
    socket.on("sendMessage",({code,message})=>{

        const groupCode=(code||"").trim().toUpperCase();
        const group=groups.get(groupCode);

        if(!group){
            return;
        }

        if(!message||!message.trim()){
            return;
        }

        const newMessage={
            id:crypto.randomUUID(),
            sender:socket.userName,
            message:message.trim(),
            time:getTime(),
            timestamp:getNow()
        };

        group.history.push(newMessage);

        // Maximum 200 messages
        if(group.history.length>200){
            group.history.shift();
        }

        io.to(groupCode).emit(
            "newMessage",
            newMessage
        );
    });

    // DELETE MESSAGE
    socket.on(
        "deleteMessage",
        ({code,messageId})=>{

            const groupCode=
                (code||"").trim().toUpperCase();

            const group=
                groups.get(groupCode);

            if(!group){
                return;
            }

            const message=
                group.history.find(
                    msg=>msg.id===messageId
                );

            if(!message){
                return;
            }

            if(message.sender!==socket.userName){
                return;
            }

            group.history=
                group.history.filter(
                    msg=>msg.id!==messageId
                );

            io.to(groupCode).emit(
                "messageDeleted",
                messageId
            );
        }
    );

    // TYPING
    socket.on("typing",({code})=>{
        socket.to(code).emit(
            "userTyping",
            socket.userName
        );
    });

    socket.on("stopTyping",({code})=>{
        socket.to(code).emit(
            "userStopTyping"
        );
    });

    // DISCONNECT
    socket.on("disconnect",()=>{

        const code=socket.groupCode;

        if(!code){
            return;
        }

        const group=groups.get(code);

        if(!group){
            return;
        }

        // Find current member
        const member=group.members.find(
            item=>item.socketId===socket.id
        );

        if(member){

            member.online=false;

            // IMPORTANT:
            // When this member leaves/closes,
            // reset THEIR history position.
            const memberRecord=
                group.memberHistory.get(
                    member.memberId
                );

            if(memberRecord){
                memberRecord.resetAfter=getNow();
            }
        }

        // Remove inactive socket
        group.members=
            group.members.filter(
                item=>item.online
            );

        socket.to(code).emit(
            "systemMessage",
            {
                text:`${socket.userName} left the group`,
                time:getTime()
            }
        );

        // Update online members
        io.to(code).emit(
            "membersUpdate",
            group.members.map(member=>({
                name:member.name,
                online:true
            }))
        );

        // If nobody is online,
        // clear complete group history.
        if(group.members.length===0){

            group.history=[];

            console.log(
                "No members online. Group history cleared."
            );
        }

        console.log(
            `${socket.userName} disconnected`
        );
    });
});

// SERVER
const PORT=process.env.PORT||3000;

server.listen(
    PORT,
    "0.0.0.0",
    ()=>{
        console.log(
            `Chat server running on port ${PORT}`
        );
    }
);