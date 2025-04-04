import { ProfileMapContext } from "@/utils/context/context";
import { User } from "@nextui-org/react";
import { nip19 } from "nostr-tools";
import { useContext, useEffect, useState } from "react";
import { verifyNip05Identifier } from "@/components/utility/nostr-helper-functions";

export const ProfileAvatar = ({
  pubkey,
  description,
  baseClassname,
  descriptionClassname,
  wrapperClassname,
}: {
  pubkey: string;
  description?: string;
  descriptionClassname?: string;
  baseClassname?: string;
  wrapperClassname?: string;
}) => {
  const [pfp, setPfp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isNip05Verified, setIsNip05Verified] = useState(false);
  const [nip05Identifier, setNip05Identifier] = useState<string | null>(null);
  const profileContext = useContext(ProfileMapContext);
  const npub = pubkey ? nip19.npubEncode(pubkey) : "";
  useEffect(() => {
    const profileMap = profileContext.profileData;
    const profile = profileMap.has(pubkey) ? profileMap.get(pubkey) : undefined;
    setDisplayName(() => {
      let displayName =
        profile && profile.content.name ? profile.content.name : npub;
      displayName =
        displayName.length > 20
          ? displayName.slice(0, 20) + "..."
          : displayName;
      return displayName;
    });

    setPfp(
      profile && profile.content.picture
        ? profile.content.picture
        : `https://robohash.idena.io/${pubkey}`,
    );

    if (profile?.content?.nip05) {
      setNip05Identifier(profile.content.nip05);
      verifyNip05Identifier(profile.content.nip05).then(setIsNip05Verified);
    }
  }, [profileContext, pubkey]);

  return (
    <User
      avatarProps={{
        src: pfp,
      }}
      className={"transition-transform"}
      classNames={{
        name: `overflow-hidden ${isNip05Verified ? 'text-shopstr-purple dark:text-shopstr-yellow' : 'text-ellipsis whitespace-nowrap text-light-text dark:text-dark-text hidden block'}`,
        base: `${baseClassname}`,
        description: `${descriptionClassname}`,
        wrapper: `${wrapperClassname}`,
      }}
      name={isNip05Verified && nip05Identifier ? nip05Identifier : displayName}
      description={description}
    />
  );
};
