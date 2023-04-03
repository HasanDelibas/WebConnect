/**
 * TODO: If connected dont connect again
 */
class WebConnect{

  static BYNARY_TYPE_CHANNEL = "arraybuffer";
  static MAXIMUM_SIZE_DATA_TO_SEND = 65535;
  static BUFFER_THRESHOLD = 65535;
  static LAST_DATA_OF_FILE = "LDOF7";
  
  get uid(){
    return this.hash;
  }
  get id(){
    return this.hash;
  }


  constructor(options){
    this.server =  options.server;
    this.hash = null; 
    this.room = null; 
    this.role = null;
    this.name = 'Guest';
    this.channels = [];
    this.remoteMedias = []
    this.localMedias = []
    /** 
     * id: number,
     * pc: RTCPeerConnection,
     * tracks: [],
     * 
     */
    this.peers = {};
    
    this.rtcConfig = {
      'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' },
        //{ 'urls': 'stun:stun.stunprotocol.org:3478' },
      ]
    };
    this.config = {
      data:true,
      video: { 
        mandatory:{ 
          width: 320,
          height: 240,
        }
      },
      videoBandwidth:250,
      audio:true,
      audioBandwidth:50,
      name:'Guest',
    }
    for (const key in options) {
      if (Object.hasOwnProperty.call(options, key)) {
        const element = options[key];
        this[key] = element;
      }
    }

    /** @type { {type:'audio'|'video'|'screen',track:MediaStreamTrack,stream:MediaStream,senders:[{number:RTCRtpSender}]} [] } */
    this.localMedias = [];

    Trigger(this);
    this.init();

    // channels 
    let that = this;
    that.channels.unshift("WebConnect");
    for(let channel of that.channels){
      if(that["sendChannel"+channel]==null){
        that["sendChannel"+channel] = function(data,hash){
          that.sendChannel(channel,data,hash)
        }
      }
      if(that["onChannel"+channel]==null){
        that["onChannel"+channel] = function(data,user){
          console.log("webConnect.onChannel"+channel+"("+JSON.stringify(data)+","+user+")")
        }
      }
    }

  }

  get connecttedPeers(){
    let peers = {}
    for (const key in this.peers) {
      if (Object.hasOwnProperty.call(this.peers, key)) {
        const peer = this.peers[key];
        if(peer.pc.connectionState=="connected"){
          peers[key] = peer;
        }
      }
    }
    return peers;
  }

  /**
   * @param {object} options
   */
  init(){
    this.socket = io(this.server,{ 
      autoConnect: true ,
      reconnection: true,
      reconnectionDelay: 1000,
      query: {
        name: this.name
      },
      path: this.path,
      transports: ["websocket"],
    });
    this.socket.on("connect",()=>{
      this.hash = this.socket.id;
    });
    this.socket.on("currentTime",console.log)
    this.socket.on("data",(action,data)=>{
      this.on(action,data);
    })
    this.socket.on("room",(data)=>{
      console.log("onRoom",data);
      this.room = {}
      for (const key in data) {
        if (Object.hasOwnProperty.call(data, key)) {
          const element = data[key];
          this.room[element.id] = element;
        }
      }
      
      for(let hash in this.peers){
        let peer = this.peers[hash];
        let pc = peer.pc;
        if( pc.connectionState=="disconnected" || pc.connectionState=="failed" || pc.connectionState=="closed" ){
          pc.close();
          delete this.peers[hash];
          continue
        }
        /*
        // New connection and 12 seconds passed
        if( pc.connectionState=="new" && (new Date().getTime()/1000-peer.time)>12 ){
          pc.close();
          delete this.peers[hash];
        }
        */
      }

      for(let user of data){
        if(user.hash == this.hash) continue;
        if(this.peers[user.hash]==null && this.hash.toString() > user.hash.toString()){
          this.#createOffer(user.hash,user);
        }
      }

    })
    
    this.socket.on("offer",({from,data})=>{
      console.log("onOffer",from,data);
      this.#offer(from,data);
    })

    this.socket.on("answer",({from,data})=>{
      console.log("onAnswer",from,data);
      this.#answer(from,data);
    })

    this.socket.on("candidate",({from,data})=>{
      console.log("onCandidate",from,data);
      this.#candidate(from,data);
    })


  }
  
  check(){
    if(this.ready){
      this.emit("check",Object.keys(this.peers));
    }
  }

  emit(action,data={}){
    var sendData= {
      hash : this.hash,
      room : this.room,
      action : action,
      data   : data
    }
    this.socket.emit(action,data);
  }

  createPeer(hash,user={}){
    if(this.peers[hash]){
      return this.peers[hash];
    }
    let that = this;
    let peer = this.peers[hash] = {}
    peer.hash = user.hash;
    peer.time = new Date().getTime()/1000;
    peer.user = {
      id: user.id,
      name: user.name,
      hash: user.hash,
      role: user.role,
    }
    let pc = peer.pc = new RTCPeerConnection(this.rtcConfig,{
      optional: [{RtpDataChannels: true}] 
    });
    peer.pc.candidates = []
    peer.pc.onicecandidate = (event) => {
      if (event.candidate) {
        //console.log("icecandidate");
        if(peer.pc.candidates.length==0){
          //setTimeout( sendIceCandidates , 2000 ); 
        }
        peer.pc.candidates.push(event.candidate);
        //console.log("icecanditate", event.candidate)
        this.emit("candidate",{ to:hash, data:event.candidate });
      }
    };

    peer.pc.onnegotiationneeded = () => {
      console.log("needed")
      peer.pc.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1,
      }).then((offer)=>{
        offer.sdp = this.setBandwidth(offer.sdp);
        peer.pc.setLocalDescription(offer).then(()=>{
          this.emit("offer",{
            to     : hash,
            data   : offer
          });
        })
      })
    }

    // this moved to on connected
    /*
    for(let localMedia of this.localMedias){
      let track = localMedia.track;
      let stream = localMedia.stream;
      localMedia.senders[hash] = pc.addTrack(track,stream);
      console.log("Add Track Request");
    }
    */

    peer.tracks = [];
    pc.ontrack = ({track, streams: [stream]}) => {
      //console.log("#onAddTrack",track,stream);
      let media = null;
      if(track.kind=="video"){
        media = document.createElement("video");
        media.srcObject = stream;
        media.autoplay = true;
        media.setAttribute("stream-id","ID-"+stream.id)
        media.setAttribute("user-id",hash)
        if(this.mediaTypes[stream.id]){
          media.setAttribute("media-type",this.mediaTypes[stream.id])
        }
        this.onVideoAdd(media,peer.user);
        media.play();
      }else if(track.kind=="audio"){
        media = document.createElement("audio");
        media.srcObject = stream;
        media.autoplay = true;
        media.setAttribute("stream-id","ID-"+stream.id)
        media.setAttribute("user-id",hash)
        this.onAudioAdd(media,peer.user);
        media.play();
      }
      peer.tracks.push(media)
      stream.onremovetrack = ({track}) => {
        if(media.parentNode){
          that.onVideoRemove(media,peer.user)
          media.srcObject = null;
          //console.log(`${track.kind} track was removed.`);
          //if (!stream.getTracks().length) {
          //  console.log(`stream ${stream.id} emptied (effectively removed).`);
          //}
        }
      };
    };
    
    var dataChannelOptions = {
      ordered: true, // do guarantee order
      //maxRetransmitTime: 1000, // in milliseconds
      reliable: true, // do guarantee order
      negotiated: true,
      id: 0
    };



    let dataChannel  = pc.createDataChannel("dataChannel", dataChannelOptions);
    dataChannel.binaryType = WebConnect.BYNARY_TYPE_CHANNEL;

    pc.addEventListener("datachannel", ev => {
      peer.receiveChannel = ev.channel;
      peer.receiveChannel.onmessage = dataChannel.onmessage;
      peer.receiveChannel.onopen = dataChannel.onopen;
      peer.receiveChannel.onclose = dataChannel.onopen;
      that.onConnect(peer.user,hash);
      that.trigger("connect",[peer.user,hash]);
    }, false);
  
    dataChannel.onerror = function (error) {
      //console.log("Data Channel Error:", error);
    };

    let chunkSize = 0;
    let chunk = "";
    dataChannel.onmessage =  (event) => {
      if(parseInt(event.data)==event.data){
        chunkSize = parseInt(event.data);
        chunk = "";
      }else{
        chunk += event.data;
        
        let percent = (chunk.length / chunkSize * 100).toFixed(2);
        if(percent>100) percent=100;
        this.onProgress( {type:'download', name:"",percent },hash);

        if(chunk.length==chunkSize){
          let packet = JSON.parse(chunk);
          console.log("onMessage",packet);
          if(packet.format=="file"){
            let a = document.createElement("a");
            a.href = packet.data;
            a.download = packet.name;
            that.onFile(packet,hash,a);
          }
          if(packet.format=="data"){
            that.onData(packet.data,hash);
          }
        }
      }
    };

    dataChannel.onopen = function () {
      //dataChannel.send("Hello World!");
    };
    dataChannel.onclose = function () {
      //console.log("The Data Channel is Closed");
    };


    let channelIndex = 1;
    peer.channels = [];

    for(let channel of that.channels){
      var subtitleDataChannelOptions = {
        ordered: true, // do guarantee order
        //maxRetransmitTime: 1000, // in milliseconds
        reliable: true, // do guarantee order
        negotiated: true,
        id: channelIndex
      };
      let _channel = peer.channels[channel] = pc.createDataChannel(channel, subtitleDataChannelOptions);
      _channel.binaryType = WebConnect.BYNARY_TYPE_CHANNEL;

      _channel.onmessage = function(event){
        if(that["onChannel"+channel]){
          that["onChannel"+channel](event.data,peer.hash)
        }else{
          console.log("webConnect.onChannel"+channel+"("+event.data+","+peer.hash+")")
        }
      }
      _channel.onopen = function(){
        for(let i=0;i<that.unsendedMessages.length;i++){
          let message = that.unsendedMessages[i]
          if(message.hash==hash && message.channel==channel){
            that.sendChannel(message.channel,message.data,message.hash)
            that.unsendedMessages.splice(i,1)
            i--;
          }
        }
      }
      channelIndex++;
    }

    

    pc.onconnectionstatechange = function(event) {
      if(pc.connectionState=="connected"){

        for(let localMedia of that.localMedias){
          let track = localMedia.track;
          let stream = localMedia.stream;
          if(localMedia.senders[hash]==null){
            localMedia.senders[hash] = pc.addTrack(track,stream);
            that.sendChannelWebConnect(JSON.stringify({type:"mediaType",data:{streamId:stream.id,mediaType:localMedia.type}}) , hash )
          }
        }

        try{
          //that.onConnect(user,hash);
          //that.trigger("connect",[user,hash]);
        }catch(e){
          console.log(e);
        }

      }
      if(pc.connectionState=="disconnected"){
        try{
          that.onDisconnect(user,hash);
          that.trigger("disconnect",[user,hash]);
        }catch(e){
          console.log(e);
        }
        if(that.peers[hash]){
          that.peers[hash].tracks.forEach(media=>{ media.remove() });
          delete that.peers[hash];
        }
      }
    }

    peer.dataChannel = dataChannel;
    window.g = dataChannel
    return peer;
  }

  #createOffer(hash,user){
    let peer = this.createPeer(hash,user);
  }

  #offer(hash,data){
    let peer = this.createPeer(hash,this.room[hash]);
    let pc   = peer.pc;
    let description = data;
    if (description.type == "offer" && peer.pc.signalingState != "stable") {
      
      pc.setLocalDescription({type: "rollback"}).then(() => {
        function stableSetRemoteDescription(){
          if(peer.pc.signalingState != "stable"){
            setTimeout(stableSetRemoteDescription,1000);
            return;
          }else{
            peer.pc.setRemoteDescription(new RTCSessionDescription(description))
          }
        }
        stableSetRemoteDescription();
        //peer.pc.setRemoteDescription(new RTCSessionDescription(data.data));  
      });
    }else{
      peer.pc.setRemoteDescription(new RTCSessionDescription(description)).then(()=>{
        peer.pc.createAnswer((answer)=>{
          answer.sdp = this.setBandwidth(answer.sdp);
          peer.pc.setLocalDescription(answer).then(()=>{
            this.emit("answer",{
              to     : hash,
              data   : answer
            });
          })
          //console.log("emitted answer",hash,answer)
        }, function(error) {
          console.log(error);
        });
      })
      
    }
  }

  #answer(hash,data){
    let peer = this.peers[hash];
    peer.pc.setRemoteDescription(new RTCSessionDescription(data)).then(()=>{
      return
      this.emit("candidate-offer",{
        to : hash,
        data   : peer.pc.candidates
      });
    })
  }

  
  #candidate(hash,candidate){
    let peer = this.peers[hash];
    if(peer){
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }else{
      console.warn("peer not found" + hash)
      setTimeout(()=>{
        this.#candidate(hash,candidate)
      },1000)
    }
  } 

  setBandwidth(sdp) {
    sdp = sdp.replace(/a=mid:audio\r\n/g, 'a=mid:audio\r\nb=AS:' + this.config.audioBandwidth + '\r\n');
    sdp = sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:' + this.config.videoBandwidth + '\r\n');
    return sdp;
  }

  renegotiate(hash=null){
    // TODO: Suspended Later Will Open
    return;
    function renegotiatePeer(hash,user){
      let peer=this.peers[hash] = this.createPeer(hash,user);
      //console.log(peer.pc.signalingState)
      if( peer.pc.signalingState != "stable"){
        setTimeout(()=>{
          renegotiatePeer.call(this,hash,user);
        },1000);
        return;
      }
    }
    if(hash==null){
      for(let hash in this.connecttedPeers){
        renegotiatePeer.call(this,hash,this.connecttedPeers[hash].user);
      }
    }else{
      renegotiatePeer.call(this,hash,this.connecttedPeers[hash].user);
    }
  }

  
  onRequest(hash,name){
    console.log("Join request from",hash,name);
    // this.emit("accept",{ hash:hash })
  }

  onVideoAdd(media,user){
    document.body.appendChild(media);
  }
  onVideoRemove(media,user){
    media.remove();
    console.log("onVideoRemove(media,"+user+")", media,user)
  }
  onVideoDisabled(media,user){
    media.style.display="none";
    console.log("onVideoDisabled(media,"+user+")", media,user)
  }
  onVideoEnabled(media,user){
    media.style.display="none";
    console.log("onVideoEnabled(media,"+user+")", media,user)
  }
  
  
  onAudioAdd(media,user){
    document.body.appendChild(media);
  }

  onConnect(user,hash){
    console.log(hash,"connected");
  }

  onDisconnect(user,hash){
    console.log(hash,"disconnected");
  }

  onData(data,hash){
    console.log(hash,data);
  }

  

  onFile(data,hash,link){
    console.log(hash,data);
    document.body.appendChild(link);
    link.click();
  }
  onProgress(data,hash){
    if(data.type=="upload"){
      console.log("Uploading  \t",data.name,data.percent,hash)
    }else{
      console.log("Downloading\t",data.name,data.percent,hash)
    }
  }

  sendData(data,hash=null){
    if(hash==null){
      for (const remoteId in this.peers) {
        if (Object.hasOwnProperty.call(this.peers, remoteId)) {
          const peer = this.peers[remoteId];
          this.sendData(data,remoteId);
        }
      }
    }else{
      if(this.peers[hash].dataChannel.readyState=="open"){
        //this.peers[hash].dataChannel.send(data)
        // Send file part part
        let packet = {
          format:"data",
          data:data
        }
        packet = JSON.stringify(packet);
        this.peers[hash].dataChannel.send(packet.length);
        for (
          let index = 0;
          index < packet.length;
          index += WebConnect.MAXIMUM_SIZE_DATA_TO_SEND
        ) {
          this.peers[hash].dataChannel.send(
            packet.slice(index, index + WebConnect.MAXIMUM_SIZE_DATA_TO_SEND)
          );
        }
      }
    }
  }


  unsendedMessages = [];
  sendChannel(channel,data,hash=null){
    if(hash==null){
      for (const remoteId in this.peers) {
        if (Object.hasOwnProperty.call(this.peers, remoteId)) {
          const peer = this.peers[remoteId];
          this.sendChannel(channel,data,remoteId);
        }
      }
    }else{
      let _channel = this.peers[hash].channels[channel];
      if(_channel.readyState=="open"){
        _channel.send(data);
      }else{
        this.unsendedMessages.push({channel,data,hash})
      }
    }
  }



  selectFile(){
    let input = document.createElement("input");
    input.type = "file";
    input.onchange = (e)=>{
      let file = e.target.files[0];
      this.sendFile(file);
    }
    input.click();
  }

  sendFile(file,hash=null,data=null){
    if(data==null){
      let reader = new FileReader();
      reader.onload = (e) => {
        this.sendFile(file,hash,
          JSON.stringify({
            format:"file", 
            name: file.name,
            type: file.type,
            size: file.size,
            data: e.target.result
          }));
      }; 
      reader["read"+"AsDataURL"](file); 
      return;
    }
    if(hash==null){
      for (const remoteId in this.peers) {
        if (Object.hasOwnProperty.call(this.peers, remoteId)) {
          const peer = this.peers[remoteId];
          this.sendFile(file,remoteId,data);
        }
      }
    }else{
      if(this.peers[hash].dataChannel.readyState=="open"){
        this.peers[hash].dataChannel.send(data.length);

        let dataChannel = this.peers[hash].dataChannel;

        const send = (index) => {
          while (index < data.length) {
            if (dataChannel.bufferedAmount > dataChannel.bufferedAmountLowThreshold) {
              dataChannel.onbufferedamountlow = () => {
                dataChannel.onbufferedamountlow = null;
                send(index);
              };
              return;
            }
            dataChannel.send(
              data.slice(index, index + WebConnect.MAXIMUM_SIZE_DATA_TO_SEND)
            );
            index += WebConnect.MAXIMUM_SIZE_DATA_TO_SEND;
            console.log( index / data.length * 100 , " completed" );
            let percent = (index / data.length * 100).toFixed(2);
            if(percent>100) percent=100;
            this.onProgress( {type:'upload', name:file.name,percent },hash);
          }
        };
        send(0); 
      }
    }
  }
 
  /**
   * @param {MediaStreamTrack} track
   * @param {MediaStream} stream
   * @param {"camera"|"screen"|"audio"} type
   */
  addTrack(track,stream,type,element=null){
    if(this.localMedias.some(e=>e.type==type)) return;
    if(element==null){
      element = type=="audio" ? this.#createAudioElement(stream,false) : this.#createVideoElement(stream,false);
    }
    let localMedia = {
      type      : type,
      uid       : this.uid,
      id        : track.id,
      element   : element,
      stream    : stream,
      track     : track,
      senders   : {}
    }
    for(let hash in this.connecttedPeers){
      let peer=this.connecttedPeers[hash];
      localMedia.senders[hash] = peer.pc.addTrack(track,stream);
    }
    track.onended = () => {
      this.removeTrack(localMedia);
    };
    this.localMedias.push(localMedia);
    console.log("addTrack",localMedia);
  }

  removeTrack(localMedia){
    for(let hash in this.connecttedPeers){
      let peer=this.connecttedPeers[hash];
      peer.pc.removeTrack(localMedia.senders[hash]);
      this.localMedias = this.localMedias.filter(e=>e.id!=localMedia.id);
    }
    this.renegotiate();
  }

  #createVideoElement(stream,muted){
    let media = document.createElement("video");
    media.autoplay = true;
    media.muted = muted;
    media.srcObject = stream;
    media.setAttribute("stream-id","ID-"+stream.id)
    media.setAttribute("user-id",this.hash)
    media.setAttribute("media-type","camera")
    media.onloadedmetadata = () => {
      media.play();
    };
    return media;
  }
  #createAudioElement(stream,muted=false){
    let media = document.createElement("audio");
    media.autoplay = true;
    media.muted = muted;
    media.srcObject = stream;
    media.setAttribute("stream-id","ID-"+stream.id)
    media.setAttribute("user-id",this.hash)
    media.setAttribute("media-type","camera")
    media.onloadedmetadata = () => {
      media.play();
    };
    return media;
  }

  addCamera(width=320,height=240){
    navigator.mediaDevices.getUserMedia({video: { 
      mandatory:{ 
        width: width,
        height: height,
      }
    }}).then((stream)=>{
      stream.getVideoTracks().map((track,i) => track.enabled = i==0);
      this.addTrack(stream.getVideoTracks()[0],stream,"camera");
      this.onVideoAdd(
        this.#createVideoElement(stream,true), this.hash
      )

    })
  }

  addMicrophone(){
    navigator.mediaDevices.getUserMedia({audio: true}).then((stream)=>{
      stream.getAudioTracks().map((track,i) => track.enabled = i==0);
      this.addTrack(stream.getAudioTracks()[0],stream,"microphone");
    })
  }

  addScreen(){
    navigator.mediaDevices.getDisplayMedia({video: true}).then((stream)=>{
      this.addTrack(stream.getVideoTracks()[0],stream,"screen");
    })
  }

  removeCamera(){
    this.localMedias.forEach(e=>{
      if(e.type=="camera"){
        this.removeTrack(e);
      }
    })
  }

  removeMicrophone(){
    this.localMedias.forEach(e=>{
      if(e.type=="microphone"){
        this.removeTrack(e);
      }
    })
  }

  removeScreen(){
    this.localMedias.forEach(e=>{
      if(e.type=="screen"){
        this.removeTrack(e);
      }
    })
  }

  disableMicrophone(){
    this.localMedias.forEach(e=>{
      if(e.type=="microphone"){
        e.track.enabled=false;
      }
    })
  }

  enableMicrophone(){
    this.localMedias.forEach(e=>{
      if(e.type=="microphone"){
        e.track.enabled=true;
      }
    })
  }

  disableCamera(){
    this.localMedias.forEach(e=>{
      if(e.type=="camera"){
        e.track.enabled=false;
        this.sendChannelWebConnect( JSON.stringify({type:"disableCamera",data:e.stream.id}) )
        //this.sendData(JSON.stringify({type:"WebConnect::disableCamera",id:e.stream.id}));
      }
    })
  }

  enableCamera(){
    this.localMedias.forEach(e=>{
      if(e.type=="camera"){
        e.track.enabled=true;
        //this.sendData(JSON.stringify({type:"WebConnect::enableCamera",id:e.stream.id}));
        this.sendChannelWebConnect( JSON.stringify({type:"enableCamera",data:e.stream.id}) )
      }
    })
  }

  get isCameraEnabled(){
    return this.localMedias.some(e=>e.type=="camera" && e.track.enabled);
  }
  get isMicrophoneEnabled(){
    return this.localMedias.some(e=>e.type=="microphone" && e.track.enabled);
  }

  toggleCamera(){
    if(this.isCameraEnabled){
      this.disableCamera();
      return false;
    }else{
      this.addCamera();
      this.enableCamera();
      return true;
    }
  }
  toggleMicrophone(){
    if(this.isMicrophoneEnabled){
      this.disableMicrophone();
      return false;
    }else{
      this.addMicrophone();
      this.enableMicrophone();
      return true;
    }
  }

  mediaTypes = {}

  onChannelWebConnect(_data,user){
    let json = JSON.parse(_data)
    let type = json.type
    let data = json.data
    if(type=="disableCamera"){
      console.log("disable camera here",json)
      var video = document.body.querySelector("[stream-id=ID-"+data+"]");
      if(video) video.style.display = "none"
    }
    if(type=="enableCamera"){
      console.log("enable camera here",json)
      var video = document.body.querySelector("[stream-id=ID-"+data+"]");
      if(video) video.style.display = null
    }
    if(type=="mediaType"){
      console.log("media type",data)
      this.mediaTypes[data.streamId] = data.mediaType
      var element = document.body.querySelector("[stream-id=ID-"+data.streamId+"]");
      if(element) element.setAttribute("media-type",data.mediaType)
    }
  }

  static videoRequest(){
    return navigator.mediaDevices.getUserMedia({video: true});
  }

  static audioRequest(){
    return navigator.mediaDevices.getUserMedia({audio: true});
  }

  static audioAndVideoRequest(){
    return navigator.mediaDevices.getUserMedia({video: true, audio: true});
  }
  
  static screenRequest(){
    return navigator.mediaDevices.getDisplayMedia({video: true});
  }


}



var Trigger = function (obj) {
	let triggers = [];
	obj.when = function (event, process, order=0) {
		triggers.push({
			event,
			process,
			order,
			type: 'on'
		});
	}
	obj.whenone = function (event, process, order=0) {
		triggers.push({
			event, 
			process,
			order,
			type: 'once'
		});
	}
	obj.trigger = function (event, ...args) {
		for (const trigger of triggers) {
			if (trigger.event == event) {
				trigger.process.apply(obj, args);
				if (trigger.type == 'once') {
					triggers.splice(triggers.indexOf(trigger), 1);
				}
			}
		}
	}
}
